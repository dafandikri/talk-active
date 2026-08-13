import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InterviewSessionError,
  MAX_INTERVIEW_PRIMARY_QUESTIONS,
  MAX_INTERVIEW_TURNS,
  aggregateInterviewAnswers,
  aggregateInterviewDuration,
  createInterviewPlan,
  nextInterviewQuestion,
  validateInterviewJudgment,
  validateInterviewTurnDraft,
} from '../apps/web/lib/interview-session.ts';

function criterion(id, displayOrder) {
  return {
    id,
    name: `Criterion ${id}`,
    description: `Description ${id}`,
    requiredEvidence: [`proof ${id}`, `outcome ${id}`],
    sourceExcerpt: null,
    displayOrder,
  };
}

const supported = {
  verdict: 'supported', coverageScore: 1, citedSpan: 'Exact answer evidence.',
  missingEvidence: [], engine: 'semantic',
};
test('interview plan follows rubric order and caps primary questions', () => {
  const criteria = Array.from({ length: 8 }, (_, index) => criterion(String(index), 7 - index));
  const plan = createInterviewPlan(criteria, 'en-US');
  assert.equal(plan.length, MAX_INTERVIEW_PRIMARY_QUESTIONS);
  assert.deepEqual(plan.map((question) => question.criterion.displayOrder), [0, 1, 2, 3, 4]);
  assert.match(plan[0].text, /Make this evidence explicit/u);
});

test('questions advance in fixed rubric order without a model verdict', () => {
  const plan = createInterviewPlan([criterion('a', 0), criterion('b', 1)], 'en-US');
  const next = nextInterviewQuestion(plan, plan[0]);
  assert.equal(next?.kind, 'primary');
  assert.equal(next?.criterion.id, 'b');
  assert.equal(nextInterviewQuestion(plan, next), null);
  assert.equal(MAX_INTERVIEW_TURNS, MAX_INTERVIEW_PRIMARY_QUESTIONS);
});

test('aggregate transcript contains answers only and duration is summed', () => {
  const plan = createInterviewPlan([criterion('a', 0)], 'en-US');
  const turns = [
    { id: '1', question: plan[0], answer: ' First answer. ', durationSeconds: 12.4, answerStartMs: 1_000, answerEndMs: 13_400 },
    { id: '2', question: plan[0], answer: 'Second answer.', durationSeconds: 9.4, answerStartMs: 15_000, answerEndMs: 24_400 },
  ];
  const transcript = aggregateInterviewAnswers(turns);
  assert.equal(transcript, 'First answer.\n\nSecond answer.');
  assert.doesNotMatch(transcript, /Make this evidence explicit/u);
  assert.equal(aggregateInterviewDuration(turns), 22);
});

test('answer windows use one ordered interview timeline', () => {
  const plan = createInterviewPlan([criterion('a', 0)], 'en-US');
  const checked = validateInterviewTurnDraft({
    id: 'a:1',
    question: plan[0],
    answer: ' Evidence for criterion a. ',
    durationSeconds: 8.6,
    answerStartMs: 1_250.4,
    answerEndMs: 9_900.7,
  });
  assert.equal(checked.answer, 'Evidence for criterion a.');
  assert.equal(checked.answerStartMs, 1_250);
  assert.equal(checked.answerEndMs, 9_901);
  assert.equal(checked.durationSeconds, 9);
  assert.throws(
    () => validateInterviewTurnDraft({ ...checked, answerStartMs: 10_000, answerEndMs: 9_000 }),
    (error) => error instanceof InterviewSessionError && error.code === 'invalid_answer_window',
  );
});

test('malformed verdicts fail loudly with a typed error', () => {
  assert.throws(
    () => validateInterviewJudgment({ ...supported, citedSpan: null }),
    (error) => error instanceof InterviewSessionError && error.code === 'unsupported_verdict_shape',
  );
  assert.throws(
    () => validateInterviewJudgment({
      verdict: 'unsupported', coverageScore: 0, citedSpan: null,
      missingEvidence: [], engine: 'deterministic',
    }),
    InterviewSessionError,
  );
});
