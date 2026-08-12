import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FALLBACK_AFTER_MS,
  analysisStages,
} from '../src/analysis-progress.mjs';

// The panel exists because a user watching one unchanging spinner for twenty
// seconds cannot tell a working product from a hung one. Everything it says
// has to be something the interface actually knows (INV-2) — the deterministic
// pass really has finished, the request really is in flight, and the fallback
// deadline really is the one the server enforces.

test('the deterministic pass is reported as already finished, with its real count', () => {
  const [first] = analysisStages({ criteriaCount: 4, elapsedMs: 0 });
  assert.equal(first.id, 'deterministic');
  assert.equal(first.state, 'done');
  assert.match(first.detail, /4 criteria/u);
  assert.match(first.detail, /on this device/u);
});

test('one criterion is not described as "1 criteria"', () => {
  const [first] = analysisStages({ criteriaCount: 1, elapsedMs: 0 });
  assert.match(first.detail, /1 criterion\b/u);
});

test('the in-flight stage counts real elapsed seconds against the real deadline', () => {
  const [, second] = analysisStages({ criteriaCount: 4, elapsedMs: 6400 });
  assert.equal(second.id, 'semantic');
  assert.equal(second.state, 'active');
  assert.match(second.detail, /\b6s\b/u, 'elapsed time should be the truth, rounded down');
  assert.match(second.detail, new RegExp(`${FALLBACK_AFTER_MS / 1000}s`, 'u'));
});

test('the fallback deadline matches the budget the server actually enforces', async () => {
  const { DEFAULT_TOTAL_BUDGET_MS } = await import('../src/semantic.mjs');
  assert.equal(
    FALLBACK_AFTER_MS,
    DEFAULT_TOTAL_BUDGET_MS,
    'promising a deadline the server does not keep is a claim the build cannot support',
  );
});

test('a semantic answer is reported as quoted and then checked', () => {
  const [, second] = analysisStages({ criteriaCount: 4, elapsedMs: 9000, outcome: 'semantic' });
  assert.equal(second.state, 'done');
  assert.match(second.detail, /checked against your transcript/iu);
});

test('a fallback says so plainly instead of quietly downgrading', () => {
  const [, second] = analysisStages({ criteriaCount: 4, elapsedMs: 22000, outcome: 'deterministic' });
  assert.equal(second.state, 'skipped');
  assert.match(second.detail, /cue-matched result/iu);
});

test('a semantic answer names the provider that actually answered', () => {
  const [, second] = analysisStages({
    criteriaCount: 4, elapsedMs: 9000, outcome: 'semantic', model: 'anthropic/claude-sonnet-4.6',
  });
  assert.match(second.detail, /anthropic/iu, 'the response carries the model that answered; say so');
});

test('a known fallback reason is explained in the user’s terms', () => {
  const [, second] = analysisStages({
    criteriaCount: 4, elapsedMs: 22000, outcome: 'deterministic',
    reason: 'no quoted span could be found in the transcript',
  });
  assert.match(second.detail, /could not point to a sentence/iu);
});

test('an unrecognised failure is not dumped at the user verbatim', () => {
  const [, second] = analysisStages({
    criteriaCount: 4, elapsedMs: 22000, outcome: 'deterministic',
    reason: 'HTTP 503 upstream_connect_error {"trace":"abc123"}',
  });
  assert.doesNotMatch(second.detail, /503|trace|abc123/u, 'raw transport errors are not user-facing copy');
  assert.match(second.detail, /cue-matched result/iu, 'but the user still learns which engine answered');
});

test('no stage invents per-criterion progress the interface cannot observe', () => {
  for (const elapsed of [0, 3000, 12000, 21000]) {
    for (const stage of analysisStages({ criteriaCount: 4, elapsedMs: elapsed })) {
      assert.doesNotMatch(
        `${stage.label} ${stage.detail}`,
        /\b\d+\s*(?:of|\/)\s*\d+\b/u,
        'the client cannot see how many criteria the model has finished; claiming otherwise is fabrication',
      );
    }
  }
});
