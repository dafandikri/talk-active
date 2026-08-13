import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_RATE_LIMIT_ROUTE_COST,
  aiRateLimitConfigured,
  aiRouteUsesModel,
  evidenceRateLimitCost,
  enforceAiRateLimit,
  statelessAnalysisRateLimitCost,
} from '../apps/web/lib/api/ai-rate-limit.ts';
import { ApiProblem } from '../apps/web/lib/api/problem.ts';

const NOW = 1_786_523_200_000;
const CONFIGURED_ENV = {
  AI_EVIDENCE_MODEL: 'test/evidence',
  AI_QUESTION_MODEL: 'test/question',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
  UPSTASH_REDIS_REST_TOKEN: 'test-token',
  AI_RATE_LIMIT_HASH_SECRET: 'test-identity-secret-with-enough-entropy',
};

function request(ip = '203.0.113.42') {
  return new Request('https://talk-active.example/api/test', {
    method: 'POST',
    headers: { 'x-vercel-forwarded-for': ip },
  });
}

function recordingStore(result = {
  success: true,
  limit: 20,
  remaining: 15,
  reset: NOW + 600_000,
}) {
  const calls = [];
  return {
    calls,
    store: {
      async limit(route, identifier, cost) {
        calls.push({ route, identifier, cost });
        return result;
      },
    },
  };
}

test('A-7 skips Redis entirely when a route has no paid model configured', async () => {
  const decision = await enforceAiRateLimit(
    new Request('https://talk-active.example/api/test', { method: 'POST' }),
    'evidence',
    null,
    {
      environment: {},
      store: { limit: async () => { throw new Error('must not run'); } },
    },
  );
  assert.deepEqual(decision, { applied: false, identitiesChecked: 0 });
});

test('A-7 checks pseudonymized IP and user buckets without storing either raw identity', async () => {
  const backend = recordingStore();
  const decision = await enforceAiRateLimit(
    request(),
    'evidence',
    'student-123',
    { environment: CONFIGURED_ENV, store: backend.store, now: () => NOW },
  );

  assert.deepEqual(decision, { applied: true, identitiesChecked: 2 });
  assert.equal(backend.calls.length, 2);
  assert.deepEqual(backend.calls.map((call) => call.route), ['evidence', 'evidence']);
  assert.deepEqual(
    backend.calls.map((call) => call.cost),
    [AI_RATE_LIMIT_ROUTE_COST.evidence, AI_RATE_LIMIT_ROUTE_COST.evidence],
  );
  assert.match(backend.calls[0].identifier, /^ip:[a-f0-9]{64}$/u);
  assert.match(backend.calls[1].identifier, /^user:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(backend.calls), /203\.0\.113\.42|student-123/u);
});

test('A-7 guests consume only the pseudonymized IP bucket', async () => {
  const backend = recordingStore();
  const decision = await enforceAiRateLimit(
    request('2001:db8::8'),
    'question',
    null,
    { environment: CONFIGURED_ENV, store: backend.store },
  );
  assert.equal(decision.identitiesChecked, 1);
  assert.equal(backend.calls[0].route, 'question');
  assert.equal(backend.calls[0].cost, 2);
});

test('A-7 accepts the operator-attested Vercel Firewall boundary only on Vercel', async () => {
  const environment = {
    AI_EVIDENCE_MODEL: 'test/evidence',
    AI_RATE_LIMIT_MODE: 'vercel-firewall',
    VERCEL: '1',
  };
  assert.equal(aiRateLimitConfigured(environment), true);
  assert.equal(aiRateLimitConfigured({ ...environment, VERCEL: '' }), false);

  const decision = await enforceAiRateLimit(
    new Request('https://talk-active.example/api/test', { method: 'POST' }),
    'evidence',
    null,
    {
      environment,
      store: { limit: async () => { throw new Error('WAF mode must not call Redis'); } },
    },
  );
  assert.deepEqual(decision, { applied: true, identitiesChecked: 1 });
});

test('A-7 stateless analysis reserves the maximum provider calls for its actual criterion count', async () => {
  const backend = recordingStore();
  const cost = statelessAnalysisRateLimitCost(7, CONFIGURED_ENV);
  await enforceAiRateLimit(
    request(),
    'analysis',
    null,
    { environment: CONFIGURED_ENV, store: backend.store, cost },
  );
  assert.equal(backend.calls[0].route, 'analysis');
  assert.equal(backend.calls[0].cost, 16);
  assert.equal(statelessAnalysisRateLimitCost(20, CONFIGURED_ENV), 42);
  assert.equal(
    statelessAnalysisRateLimitCost(7, { AI_QUESTION_MODEL: 'test/question' }),
    2,
  );
  assert.equal(aiRouteUsesModel('analysis', CONFIGURED_ENV), true);
});

test('A-7 persistent evidence reserves two attempts per actual criterion, not the 20-row maximum', () => {
  assert.equal(evidenceRateLimitCost(4, CONFIGURED_ENV), 8);
  assert.equal(evidenceRateLimitCost(20, CONFIGURED_ENV), 40);
  assert.equal(evidenceRateLimitCost(4, {}), 1);
  assert.ok(evidenceRateLimitCost(4, CONFIGURED_ENV) * 2 <= 50);
});

test('A-7 rejects paid execution when configuration or a trustworthy IP is missing', async () => {
  await assert.rejects(
    enforceAiRateLimit(request(), 'evidence', null, {
      environment: { AI_EVIDENCE_MODEL: 'test/evidence' },
    }),
    (error) => error instanceof ApiProblem
      && error.status === 503
      && error.code === 'ai_rate_limit_unavailable',
  );
  await assert.rejects(
    enforceAiRateLimit(
      new Request('https://talk-active.example/api/test', { method: 'POST' }),
      'evidence',
      null,
      { environment: CONFIGURED_ENV, store: recordingStore().store },
    ),
    (error) => error instanceof ApiProblem
      && error.status === 503
      && /identity/u.test(error.message),
  );
});

test('A-7 treats an Upstash timeout as unavailable instead of allowing model spend', async () => {
  const backend = recordingStore({
    success: true,
    limit: 20,
    remaining: 20,
    reset: NOW + 600_000,
    reason: 'timeout',
  });
  await assert.rejects(
    enforceAiRateLimit(request(), 'evidence', null, {
      environment: CONFIGURED_ENV,
      store: backend.store,
    }),
    (error) => error instanceof ApiProblem
      && error.status === 503
      && /timed out/u.test(error.message),
  );
});

test('A-7 returns a typed 429 with Retry-After when either identity is exhausted', async () => {
  const results = [
    { success: true, limit: 20, remaining: 14, reset: NOW + 600_000 },
    { success: false, limit: 20, remaining: 0, reset: NOW + 42_100 },
  ];
  const store = { limit: async () => results.shift() };
  let problem;
  try {
    await enforceAiRateLimit(request(), 'defense', 'student-123', {
      environment: CONFIGURED_ENV,
      store,
      now: () => NOW,
    });
  } catch (error) {
    problem = error;
  }
  assert.ok(problem instanceof ApiProblem);
  assert.equal(problem.status, 429);
  assert.equal(problem.code, 'ai_rate_limit_exceeded');
  assert.match(problem.message, /43 seconds/u);

  assert.equal(new Headers(problem.headers).get('retry-after'), '43');
});

test('A-7 semantic capability requires all limiter credentials and maps defense fallback', () => {
  assert.equal(aiRateLimitConfigured(CONFIGURED_ENV), true);
  assert.equal(aiRateLimitConfigured({ ...CONFIGURED_ENV, AI_RATE_LIMIT_HASH_SECRET: '' }), false);
  assert.equal(aiRateLimitConfigured({ ...CONFIGURED_ENV, AI_RATE_LIMIT_HASH_SECRET: 'too-short' }), false);
  assert.equal(aiRateLimitConfigured({ ...CONFIGURED_ENV, AI_RATE_LIMIT_MAX_TOKENS: '41' }), false);
  assert.equal(aiRouteUsesModel('defense', CONFIGURED_ENV), true);
  assert.equal(aiRouteUsesModel('rubric', CONFIGURED_ENV), false);
});
