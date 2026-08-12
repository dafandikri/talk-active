import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readCachedStatelessAnalysis,
  statelessAnalysisCacheKey,
  writeCachedStatelessAnalysis,
} from '../apps/web/lib/api/stateless-analysis-cache.ts';
import { StatelessAnalysisResponseSchema } from '../apps/web/lib/contracts.ts';
import { analyzeStatelessAttempt } from '../apps/web/lib/services/stateless-analysis.ts';

const INPUT = {
  transcript: 'We interviewed students on three campuses. Our rubric gives them focused feedback.',
  criteria: [
    {
      id: 'problem-clarity', name: 'Problem clarity', description: 'Show urgency.',
      requiredEvidence: ['interviewed', 'urgency'], displayOrder: 0,
    },
    {
      id: 'solution-fit', name: 'Solution fit', description: 'Connect the mechanism to an outcome.',
      requiredEvidence: ['rubric', 'feedback', 'measurable improvement'], displayOrder: 1,
    },
  ],
  durationSeconds: 60,
};

const SEMANTIC_JUDGMENTS = [
  {
    criterionId: 'problem-clarity',
    verdict: 'partial',
    coverageScore: 0.5,
    citedSpan: 'We interviewed students on three campuses.',
    missingEvidence: ['urgency'],
    engine: 'semantic',
    model: 'test/evidence',
    attempts: 1,
    degradedReason: null,
  },
  {
    criterionId: 'solution-fit',
    verdict: 'partial',
    coverageScore: 0.5,
    citedSpan: 'Our rubric gives them focused feedback.',
    missingEvidence: ['measurable improvement'],
    engine: 'semantic',
    model: 'test/evidence',
    attempts: 1,
    degradedReason: null,
  },
];

test('A-1 stateless semantic analysis preserves the analyzer shape and exact evidence provenance', async () => {
  const response = await analyzeStatelessAttempt(INPUT, {
    judge: async () => SEMANTIC_JUDGMENTS,
    question: async () => ({
      questionText: 'What direct evidence shows that the student problem is urgent right now?',
      challengedClaim: 'urgency',
      basis: 'missing-evidence',
      sourceDocumentId: null,
      engine: 'semantic',
      model: 'test/question',
      degradedReason: null,
    }),
  });

  assert.equal(StatelessAnalysisResponseSchema.safeParse(response).success, true);
  assert.equal(response.mode, 'semantic');
  assert.equal(response.analysis.criteria.length, 2);
  assert.equal(response.analysis.weakest.id, 'problem-clarity');
  assert.equal(response.analysis.criteria[0].excerpt, SEMANTIC_JUDGMENTS[0].citedSpan);
  assert.deepEqual(response.criterionEngines.map((item) => item.engine), ['semantic', 'semantic']);
  assert.equal(response.questionEngine, 'semantic');
});

test('A-3 a failed stateless model orchestration degrades to a valid deterministic review', async () => {
  const response = await analyzeStatelessAttempt(INPUT, {
    judge: async () => { throw new Error('provider unavailable'); },
    question: async () => { throw new Error('provider unavailable'); },
  });

  assert.equal(response.mode, 'deterministic');
  assert.equal(response.analysis.criteria.length, 2);
  assert.ok(response.analysis.criteria.every((criterion) => (
    criterion.status === 'missing' ? criterion.excerpt === '' : criterion.excerpt.length > 0
  )));
  assert.ok(response.criterionEngines.every((item) => item.engine === 'deterministic'));
  assert.equal(response.questionEngine, 'deterministic');
});

test('INV-3 deterministic coverage stays partial while any declared evidence is missing', async () => {
  const result = await analyzeStatelessAttempt({
    transcript: 'Our product explains the problem for students with evidence.',
    durationSeconds: 60,
    criteria: [{
      id: 'problem',
      name: 'Problem',
      description: 'Explain the problem, students, evidence, and urgency.',
      requiredEvidence: ['problem', 'students', 'evidence', 'urgency'],
      displayOrder: 0,
    }],
  }, {
    evidenceOptions: { model: '' },
    questionOptions: { model: '' },
  });

  assert.equal(result.analysis.criteria[0].score, 50);
  assert.equal(result.analysis.criteria[0].status, 'partial');
  assert.deepEqual(result.analysis.criteria[0].missingSignals, ['urgency']);
});

test('A-5 analysis cache hashes transcript plus rubric and recomputes duration-only delivery', async () => {
  const values = new Map();
  const store = {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); return 'OK'; },
  };
  const response = await analyzeStatelessAttempt(INPUT, {
    judge: async () => SEMANTIC_JUDGMENTS,
    question: async () => ({
      questionText: 'What direct evidence shows that the student problem is urgent right now?',
      challengedClaim: 'urgency',
      basis: 'missing-evidence',
      sourceDocumentId: null,
      engine: 'semantic',
      model: 'test/question',
      degradedReason: null,
    }),
  });
  await writeCachedStatelessAnalysis(INPUT, response, { store });

  const faster = await readCachedStatelessAnalysis(
    { ...INPUT, durationSeconds: 30 },
    { store },
  );
  assert.ok(faster);
  assert.equal(faster.cached, true);
  assert.equal(faster.analysis.delivery.durationSeconds, 30);
  assert.equal(faster.analysis.delivery.wordsPerMinute, response.analysis.delivery.wordsPerMinute * 2);
  assert.equal(
    statelessAnalysisCacheKey(INPUT),
    statelessAnalysisCacheKey({ ...INPUT, durationSeconds: 10 }),
  );
  assert.notEqual(
    statelessAnalysisCacheKey(INPUT),
    statelessAnalysisCacheKey({
      ...INPUT,
      criteria: [{
        id: 'different', name: 'Different', description: '',
        requiredEvidence: ['evidence'], displayOrder: 0,
      }],
    }),
  );
  assert.notEqual(
    statelessAnalysisCacheKey(INPUT, { AI_EVIDENCE_MODEL: 'model-a' }),
    statelessAnalysisCacheKey(INPUT, { AI_EVIDENCE_MODEL: 'model-b' }),
  );
});

test('A-1 structured criteria reach the semantic judge without flattening phrases or descriptions', async () => {
  const received = [];
  await analyzeStatelessAttempt(INPUT, {
    judge: async (_transcript, criteria) => {
      received.push(...criteria);
      return SEMANTIC_JUDGMENTS;
    },
    question: async () => ({
      questionText: 'What direct evidence shows that the student problem is urgent right now?',
      challengedClaim: 'urgency',
      basis: 'missing-evidence',
      sourceDocumentId: null,
      engine: 'semantic',
      model: 'test/question',
      degradedReason: null,
    }),
  });
  assert.equal(received[1].description, 'Connect the mechanism to an outcome.');
  assert.deepEqual(received[1].requiredEvidence, ['rubric', 'feedback', 'measurable improvement']);
});

test('A-1 duplicate criterion names retain distinct typed ids and verdicts', async () => {
  const input = {
    ...INPUT,
    criteria: [
      { id: 'impact', name: 'Impact', description: 'Beneficiary', requiredEvidence: ['beneficiary'], displayOrder: 0 },
      { id: 'impact-2', name: 'Impact', description: 'Measurement', requiredEvidence: ['measure'], displayOrder: 1 },
    ],
  };
  const response = await analyzeStatelessAttempt(input, {
    judge: async () => [
      { ...SEMANTIC_JUDGMENTS[0], criterionId: 'impact' },
      { ...SEMANTIC_JUDGMENTS[1], criterionId: 'impact-2' },
    ],
    question: async () => ({
      questionText: 'Which beneficiary receives the first measurable outcome from this intervention?',
      challengedClaim: 'beneficiary', basis: 'missing-evidence', sourceDocumentId: null,
      engine: 'semantic', model: 'test/question', degradedReason: null,
    }),
  });
  assert.deepEqual(response.analysis.criteria.map(({ id }) => id), ['impact', 'impact-2']);
});

test('A-5 deterministic fallbacks are not cached as semantic answers', async () => {
  let writes = 0;
  const deterministic = await analyzeStatelessAttempt(INPUT, {
    judge: async () => { throw new Error('offline'); },
  });
  await writeCachedStatelessAnalysis(INPUT, deterministic, {
    store: {
      async get() { return null; },
      async set() { writes += 1; return 'OK'; },
    },
  });
  assert.equal(writes, 0);
});
