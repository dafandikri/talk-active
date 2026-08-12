import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AnalysisError, analyzeSpeech, evaluateDefense } from '../src/analyzer.mjs';
import {
  ANALYSIS_SCENARIOS,
  DEFENSE_SCENARIOS,
  ERROR_SCENARIOS,
} from './fixtures/golden-scenarios.mjs';

// The recorded behaviour of the analyzer as it stands. Its whole job is to make
// "did we change anything?" a diff rather than a discussion — most immediately
// for the TypeScript port, where the analyzer is the piece that carries over
// unchanged and therefore the piece nobody will think to re-verify.
//
// A failure here is not automatically a bug: it means behaviour moved. Either
// the change was intended, in which case regenerate with `pnpm golden:capture`
// and show the diff in the commit, or it was not, in which case you have just
// caught a regression that no other test in this repo would have noticed.
const golden = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/golden-path.json', import.meta.url)),
  'utf8',
));

test('the baseline covers every scenario, so none can be quietly dropped', () => {
  assert.deepEqual(
    golden.analyses.map((entry) => entry.id),
    ANALYSIS_SCENARIOS.map((scenario) => scenario.id),
    'golden-path.json is out of step with golden-scenarios.mjs — run pnpm golden:capture',
  );
  assert.deepEqual(golden.defenses.map((entry) => entry.id), DEFENSE_SCENARIOS.map((scenario) => scenario.id));
  assert.deepEqual(golden.errors.map((entry) => entry.id), ERROR_SCENARIOS.map((scenario) => scenario.id));
});

for (const entry of golden.analyses) {
  test(`analysis is unchanged: ${entry.id} — ${entry.description}`, () => {
    assert.deepEqual(analyzeSpeech(entry.input), entry.output);
  });
}

for (const entry of golden.defenses) {
  test(`defense evaluation is unchanged: ${entry.id} — ${entry.description}`, () => {
    assert.deepEqual(evaluateDefense(entry.input), entry.output);
  });
}

for (const entry of golden.errors) {
  test(`invalid input still fails loudly and identically: ${entry.id}`, () => {
    assert.throws(
      () => analyzeSpeech(entry.input),
      (error) => {
        assert.ok(error instanceof AnalysisError, `${entry.id} threw ${error?.constructor?.name}, not AnalysisError`);
        assert.equal(error.code, entry.error.code);
        assert.equal(error.message, entry.error.message);
        return true;
      },
    );
  });
}

// Properties that must hold for every scenario, whatever the recorded numbers
// are. These survive a deliberate regeneration; the deepEqual assertions above
// do not, which is exactly why both exist.
test('every recorded verdict cites evidence or names what is missing (INV-3)', () => {
  for (const entry of golden.analyses) {
    for (const criterion of entry.output.criteria) {
      // Either a quoted span from the transcript, or an explicit list of the
      // cues that were not found. A verdict with neither is the thing INV-3
      // exists to prevent.
      const quoted = typeof criterion.excerpt === 'string' && criterion.excerpt.trim().length > 0;
      const missing = Array.isArray(criterion.missingSignals) && criterion.missingSignals.length > 0;
      assert.ok(
        quoted || missing,
        `${entry.id}/${criterion.id} reaches the user with nothing to point at`,
      );
    }
  }
});

test('no recorded coverage figure escapes 0–100', () => {
  for (const entry of golden.analyses) {
    assert.ok(
      Number.isInteger(entry.output.evidenceScore)
      && entry.output.evidenceScore >= 0
      && entry.output.evidenceScore <= 100,
      `${entry.id} recorded an out-of-range coverage figure: ${entry.output.evidenceScore}`,
    );
    assert.ok(entry.output.coveredCount <= entry.output.criterionCount, `${entry.id} covered more criteria than exist`);
  }
});

test('the weakest criterion is always one of the criteria actually analysed', () => {
  for (const entry of golden.analyses) {
    const ids = entry.output.criteria.map((criterion) => criterion.id);
    assert.ok(
      ids.includes(entry.output.weakest.id),
      `${entry.id} nominated a weakest criterion that is not in its own rubric`,
    );
  }
});

test('a judge question is produced for every scenario, never an empty prompt', () => {
  for (const entry of golden.analyses) {
    assert.ok(
      typeof entry.output.judgeQuestion === 'string' && entry.output.judgeQuestion.trim().length > 10,
      `${entry.id} produced no usable judge question`,
    );
  }
});
