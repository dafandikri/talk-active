import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  InterviewAnalysisRequestSchema,
  InterviewAnalysisResponseSchema,
} from '../apps/web/lib/contracts.ts';
import { analyzeInterview } from '../apps/web/lib/services/interview-analysis.ts';

function criterion(id, displayOrder, requiredEvidence) {
  return {
    id,
    rubricId: 'rubric-interview',
    name: id === 'problem' ? 'Problem clarity' : 'Solution evidence',
    description: `Make ${requiredEvidence.join(' and ')} explicit.`,
    requiredEvidence,
    displayOrder,
  };
}

const INPUT = {
  turns: [
    {
      turnId: 'turn-problem',
      criterion: criterion('problem', 0, ['students', 'urgency']),
      answer: 'Students lose the chance to revise before a final evaluation.',
      durationSeconds: 12,
      answerStartMs: 2_000,
      answerEndMs: 14_000,
    },
    {
      turnId: 'turn-solution',
      criterion: criterion('solution', 1, ['rubric', 'retry']),
      answer: 'The rubric isolates one weak claim, but this answer omits a retry.',
      durationSeconds: 13,
      answerStartMs: 18_000,
      answerEndMs: 31_000,
    },
  ],
};

function judgment(criterionId, overrides = {}) {
  return {
    criterionId,
    verdict: 'supported',
    coverageScore: 1,
    citedSpan: criterionId === 'problem'
      ? 'Students lose the chance to revise before a final evaluation.'
      : 'The rubric isolates one weak claim, but this answer omits a retry.',
    missingEvidence: [],
    engine: 'semantic',
    model: 'test/evidence',
    attempts: 1,
    degradedReason: null,
    ...overrides,
  };
}

function question(overrides = {}) {
  return {
    questionText: 'What concrete retry happens after the rubric isolates the weak claim?',
    challengedClaim: 'retry',
    basis: 'missing-evidence',
    sourceDocumentId: null,
    engine: 'semantic',
    model: 'test/question',
    degradedReason: null,
    ...overrides,
  };
}

test('interview contract accepts at most five ordered answer windows and rejects question prose', () => {
  assert.equal(InterviewAnalysisRequestSchema.safeParse(INPUT).success, true);
  assert.equal(InterviewAnalysisRequestSchema.safeParse({
    turns: [{ ...INPUT.turns[0], questionText: 'Repeat this requirement to the model.' }],
  }).success, false);
  assert.equal(InterviewAnalysisRequestSchema.safeParse({
    turns: Array.from({ length: 6 }, (_, index) => ({
      ...INPUT.turns[0],
      turnId: `turn-${index}`,
      criterion: criterion(`criterion-${index}`, index, ['evidence']),
      answerStartMs: index * 20_000,
      answerEndMs: index * 20_000 + 12_000,
    })),
  }).success, false);
  assert.equal(InterviewAnalysisRequestSchema.safeParse({
    turns: [INPUT.turns[1], INPUT.turns[0]],
  }).success, false);
  assert.equal(InterviewAnalysisRequestSchema.safeParse({
    turns: [INPUT.turns[0], { ...INPUT.turns[1], answerStartMs: 13_000 }],
  }).success, false);
});

test('final interview analysis judges each answer only against its paired criterion in parallel', async () => {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  let release;
  const bothStarted = new Promise((resolve) => { release = resolve; });

  const response = await analyzeInterview(INPUT, {
    judge: async (answer, pairedCriterion) => {
      calls.push({ answer, criterionId: pairedCriterion.id });
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (calls.length === INPUT.turns.length) release();
      await bothStarted;
      active -= 1;
      return pairedCriterion.id === 'problem'
        ? judgment('problem')
        : judgment('solution', {
          verdict: 'partial',
          coverageScore: 0.5,
          citedSpan: 'The rubric isolates one weak claim',
          missingEvidence: ['retry'],
        });
    },
    question: async (answer, pairedCriterion, weakest) => {
      assert.equal(answer, INPUT.turns[1].answer);
      assert.equal(pairedCriterion.id, 'solution');
      assert.equal(weakest.missingEvidence[0], 'retry');
      return question();
    },
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(calls, INPUT.turns.map((turn) => ({
    answer: turn.answer,
    criterionId: turn.criterion.id,
  })));
  assert.equal(response.turns[0].judgment.citedSpan, INPUT.turns[0].answer);
  assert.equal(response.turns[1].judgment.citedSpan, 'The rubric isolates one weak claim');
  assert.equal(response.hardestQuestion.criterionId, 'solution');
  assert.equal(response.mode, 'semantic');
  assert.equal(InterviewAnalysisResponseSchema.safeParse(response).success, true);
});

test('an ungrounded injected verdict degrades to answer-local deterministic evidence', async () => {
  const input = {
    turns: [{
      turnId: 'turn-local',
      criterion: criterion('problem', 0, ['students']),
      answer: 'Students need feedback before the final evaluation.',
      durationSeconds: 8,
      answerStartMs: 1_000,
      answerEndMs: 9_000,
    }],
  };
  const response = await analyzeInterview(input, {
    judge: async () => judgment('problem', {
      citedSpan: 'This sentence belongs to a different answer.',
    }),
    question: async (_answer, _criterion, acceptedJudgment) => question({
      questionText: 'What evidence supports this statement from your rehearsal?',
      challengedClaim: acceptedJudgment.citedSpan,
      basis: 'transcript',
      engine: 'deterministic',
      model: null,
      degradedReason: 'Test fallback.',
    }),
  });

  const accepted = response.turns[0].judgment;
  assert.equal(accepted.engine, 'deterministic');
  assert.ok(accepted.citedSpan);
  assert.ok(input.turns[0].answer.includes(accepted.citedSpan));
  assert.equal(response.mode, 'deterministic');
});

test('interview route validates, rate-limits, and shares one request deadline', async () => {
  const route = await readFile('apps/web/app/api/interview/analyze/route.ts', 'utf8');
  assert.match(route, /withApiErrors/u);
  assert.match(route, /parseJson\(request, InterviewAnalysisRequestSchema\)/u);
  assert.match(route, /enforceAiRateLimit\(request, 'analysis'/u);
  assert.match(route, /statelessAnalysisRateLimitCost\(input\.turns\.length\)/u);
  assert.match(route, /const deadlineAt = aiRequestDeadline\(\)/u);
  assert.match(route, /evidenceOptions: \{ deadlineAt \}/u);
  assert.match(route, /questionOptions: \{ deadlineAt \}/u);
});
