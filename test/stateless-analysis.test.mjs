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
  rubricText: [
    'Problem clarity | interviewed, urgency',
    'Solution fit | rubric, feedback, measurable improvement',
  ].join('\n'),
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
    statelessAnalysisCacheKey({ ...INPUT, rubricText: 'Different | evidence' }),
  );
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
