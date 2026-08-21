import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEMANTIC_CREDENTIAL_SUSPECT_TTL_MS,
  isGatewayAuthFailure,
  recordSemanticAuthFailure,
  recordSemanticSuccess,
  resetSemanticHealth,
  semanticCredentialSuspect,
} from '../apps/web/lib/ai/semantic-health.ts';
import { judgeCriterion } from '../apps/web/lib/ai/evidence-judge.ts';

const CRITERION = {
  id: 'criterion-impact',
  rubricId: 'rubric-1',
  name: 'Impact',
  description: 'States a measured outcome.',
  requiredEvidence: ['measured outcome'],
  displayOrder: 0,
};
const TRANSCRIPT = 'We measured a 24 percent drop across 180 students in the dummy pilot.';

/**
 * The shape a real expired key produces through generateText. `.name` is the
 * only reliable marker: the `ai` package bundles its own copy of the gateway
 * module, so the branded `isInstance` check fails across the package boundary
 * even for a genuine authentication error.
 */
function gatewayAuthError() {
  const error = new Error('Unauthenticated request to AI Gateway.');
  error.name = 'GatewayAuthenticationError';
  return error;
}

test('a gateway authentication failure is recognised by name, not by instance', () => {
  assert.equal(isGatewayAuthFailure(gatewayAuthError()), true);
});

test('an ordinary provider failure is not mistaken for a dead credential', () => {
  assert.equal(isGatewayAuthFailure(new Error('The operation was aborted due to timeout')), false);
  assert.equal(isGatewayAuthFailure(null), false);
  assert.equal(isGatewayAuthFailure({ name: 'GatewayRateLimitError' }), false);
});

test('a fresh process trusts the configured credential', () => {
  resetSemanticHealth();
  assert.equal(semanticCredentialSuspect(), false);
});

test('one observed authentication failure makes the credential suspect', () => {
  resetSemanticHealth();
  const now = 1_000_000;
  recordSemanticAuthFailure(now);
  assert.equal(semanticCredentialSuspect(now), true);
});

// A rotated key arrives with a new deployment, but the suspicion must not
// outlive its usefulness inside a long-lived isolate either.
test('suspicion lapses once its window passes', () => {
  resetSemanticHealth();
  const now = 1_000_000;
  recordSemanticAuthFailure(now);
  assert.equal(
    semanticCredentialSuspect(now + SEMANTIC_CREDENTIAL_SUSPECT_TTL_MS - 1),
    true,
  );
  assert.equal(
    semanticCredentialSuspect(now + SEMANTIC_CREDENTIAL_SUSPECT_TTL_MS + 1),
    false,
  );
});

test('a successful call clears suspicion immediately', () => {
  resetSemanticHealth();
  const now = 1_000_000;
  recordSemanticAuthFailure(now);
  recordSemanticSuccess();
  assert.equal(semanticCredentialSuspect(now), false);
});

test('the evidence judge reports a dead credential it actually observed', async () => {
  resetSemanticHealth();
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/evidence-tier',
    onEvent: () => {},
    generate: async () => { throw gatewayAuthError(); },
  });
  assert.equal(result.engine, 'deterministic');
  assert.equal(semanticCredentialSuspect(), true);
});

test('a transient provider failure leaves the advertised capability alone', async () => {
  resetSemanticHealth();
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/evidence-tier',
    onEvent: () => {},
    generate: async () => { throw new Error('socket hang up'); },
  });
  assert.equal(result.engine, 'deterministic');
  assert.equal(semanticCredentialSuspect(), false);
});

test('a working call clears suspicion left by an earlier outage', async () => {
  resetSemanticHealth();
  recordSemanticAuthFailure();
  await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/evidence-tier',
    onEvent: () => {},
    generate: async () => ({
      output: {
        reasoning: 'The transcript states the measured outcome.',
        verdict: 'supported',
        citedSpan: 'We measured a 24 percent drop across 180 students',
        missingEvidence: [],
      },
      modelId: 'test/answering-model',
    }),
  });
  assert.equal(semanticCredentialSuspect(), false);
});
