import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalysisError,
  MAX_TRANSCRIPT_CHARS,
  analyzeSpeech,
  makeDrill,
  makeJudgeQuestion,
} from '../apps/web/lib/analyzer.ts';
import {
  buildMarkedRetakeTranscript,
  mergeCriterionRejudgment,
} from '../apps/web/lib/rehearsal/criterion-retake.ts';

test('a criterion addition is marked in the project language without rewriting the original take', () => {
  const original = 'The problem affects students.';

  assert.equal(
    buildMarkedRetakeTranscript(original, 'Impact proof', '  Our pilot measured improvement.  '),
    `${original}\n\n[Tambahan · Impact proof] Our pilot measured improvement.`,
  );
  assert.equal(
    buildMarkedRetakeTranscript(original, 'Impact proof', 'Our pilot measured improvement.', 'en-US'),
    `${original}\n\n[Addition · Impact proof] Our pilot measured improvement.`,
  );
});

test('a criterion addition may reach but never exceed the transcript limit', () => {
  const label = 'Impact proof';
  const addition = 'Measured improvement.';
  const marker = `\n\n[Tambahan · ${label}] `;
  const original = 'x'.repeat(MAX_TRANSCRIPT_CHARS - marker.length - addition.length);

  const atLimit = buildMarkedRetakeTranscript(original, label, addition);
  assert.equal(atLimit.length, MAX_TRANSCRIPT_CHARS);

  assert.throws(
    () => buildMarkedRetakeTranscript(`${original}x`, label, addition),
    (error) => error instanceof AnalysisError && error.code === 'transcript_too_long',
  );
});

const THREE_CRITERIA = [
  'Problem clarity | problem, students',
  'Impact proof | pilot evidence, measured improvement',
  'Feasibility proof | architecture, privacy',
].join('\n');

test('repairing the weakest criterion retargets stale question and drill text', () => {
  const initial = analyzeSpeech({
    transcript: 'The problem affects students. Our architecture is documented.',
    rubricText: THREE_CRITERIA,
    durationSeconds: 60,
    language: 'id-ID',
  });
  const before = structuredClone(initial);
  assert.equal(initial.weakest.id, 'impact-proof');

  const merged = mergeCriterionRejudgment(
    initial,
    'impact-proof',
    {
      verdict: 'supported',
      coverageScore: 1,
      citedSpan: 'Our pilot evidence measured improvement.',
      missingEvidence: [],
      engine: 'semantic',
    },
    'id-ID',
    {
      text: 'How much did the pilot improve?',
      targetCriterionId: 'impact-proof',
    },
  );

  assert.equal(merged.analysis.weakest.id, 'feasibility-proof');
  assert.equal(merged.analysis.judgeQuestion, makeJudgeQuestion(merged.analysis.weakest, 'id-ID'));
  assert.equal(merged.analysis.drill, makeDrill(merged.analysis.weakest, 'id-ID'));
  assert.match(merged.analysis.judgeQuestion, /privacy/u);
  assert.doesNotMatch(merged.analysis.judgeQuestion, /pilot|impact/iu);
  assert.equal(merged.questionRefresh, 'deterministic');
  assert.deepEqual(merged.analysis.criteria[0], initial.criteria[0]);
  assert.deepEqual(merged.analysis.criteria[2], initial.criteria[2]);
  assert.deepEqual(initial, before, 'the prior review remains immutable');
});

test('a returned question is kept only when the repaired criterion remains weakest', () => {
  const initial = analyzeSpeech({
    transcript: 'The problem affects students. Our architecture is documented.',
    rubricText: THREE_CRITERIA,
    durationSeconds: 60,
    language: 'id-ID',
  });
  const responseQuestion = 'Berapa peningkatan terukur yang dihasilkan bukti pilot tersebut?';

  const merged = mergeCriterionRejudgment(
    initial,
    'impact-proof',
    {
      verdict: 'partial',
      coverageScore: 0.5,
      citedSpan: 'Our pilot evidence compares two cohorts.',
      missingEvidence: ['measured improvement'],
      engine: 'semantic',
    },
    'id-ID',
    {
      text: responseQuestion,
      targetCriterionId: 'impact-proof',
    },
  );

  assert.equal(merged.analysis.weakest.id, 'impact-proof');
  assert.equal(merged.analysis.judgeQuestion, responseQuestion);
  assert.equal(merged.analysis.drill, makeDrill(merged.analysis.weakest, 'id-ID'));
  assert.match(merged.analysis.drill, /measured improvement/u);
  assert.equal(merged.questionRefresh, 'response');
});
