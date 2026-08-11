import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze } from '../api/analyze.mjs';

function uniqueInput(label) {
  return {
    transcript: `${label} ${crypto.randomUUID()}`,
    rubricText: 'Cache behavior | repeat, instant',
    durationSeconds: 30,
  };
}

test('identical semantic analysis is cached and replayed in under 100ms', async () => {
  const input = uniqueInput('semantic-cache');
  let calls = 0;
  const semantic = async () => {
    calls += 1;
    return { mode: 'semantic', evidenceScore: 100 };
  };

  const first = await analyze(input, semantic);
  const startedAt = performance.now();
  const replay = await analyze(input, semantic);
  const elapsed = performance.now() - startedAt;

  assert.equal(first.cached, false);
  assert.equal(replay.cached, true);
  assert.equal(calls, 1);
  assert.ok(elapsed < 100, `cached replay took ${elapsed}ms`);
});

test('deterministic degradation is never cached', async () => {
  const input = uniqueInput('degraded-cache');
  let calls = 0;
  const degraded = async () => {
    calls += 1;
    return { mode: 'deterministic', evidenceScore: 50 };
  };

  const first = await analyze(input, degraded);
  const second = await analyze(input, degraded);

  assert.equal(first.cached, false);
  assert.equal(second.cached, false);
  assert.equal(calls, 2, 'a transient degraded response must not block a later semantic retry');
});
