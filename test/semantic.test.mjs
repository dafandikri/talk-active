// Semantic evidence mapping: the fallback and the grounding rule are the two
// behaviours that decide whether the live demo survives. Both are tested here
// without touching the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_RUBRIC, STARTER_DRAFT } from '../src/analyzer.mjs';
import {
  DEFAULT_TOTAL_BUDGET_MS,
  MODEL_CHAIN,
  SemanticUnavailable,
  analyzeWithSemantics,
  applySemanticVerdicts,
  buildMessages,
  normaliseForGrounding,
  selectApiCredential,
} from '../src/semantic.mjs';

// Read the chain rather than hardcoding vendor names: the chain is expected to
// change as pricing and availability move, and these tests are about failover
// behaviour, not about which vendor happens to be first today.
const [PRIMARY, SECOND, THIRD] = MODEL_CHAIN;

const INPUT = {
  transcript: STARTER_DRAFT,
  rubricText: DEFAULT_RUBRIC,
  durationSeconds: 90,
};

// A sentence that genuinely appears in STARTER_DRAFT.
const REAL_SENTENCE = 'Talk-Active lets a student use the actual evaluation rubric while practicing a pitch.';

function gatewayReturning(payload, { ok = true, status = 200 } = {}) {
  return async () => ({
    ok,
    status,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  });
}

test('semantic analysis overlays verdicts when spans are grounded in the transcript', async () => {
  const result = await analyzeWithSemantics({
    ...INPUT,
    apiKey: 'test-key-not-real',
    fetchImpl: gatewayReturning({
      criteria: [
        { id: 'problem-clarity', status: 'covered', span: REAL_SENTENCE, missing: [], why: 'states the problem' },
        { id: 'solution-fit', status: 'partial', span: REAL_SENTENCE, missing: ['retry'], why: 'partly shown' },
        { id: 'differentiation', status: 'missing', span: '', missing: ['competitors'], why: 'absent' },
        { id: 'feasibility-and-trust', status: 'missing', span: '', missing: ['privacy'], why: 'absent' },
      ],
    }),
  });

  assert.equal(result.mode, 'semantic');
  const covered = result.criteria.find((criterion) => criterion.id === 'problem-clarity');
  assert.equal(covered.status, 'covered');
  assert.equal(covered.excerpt, REAL_SENTENCE);
  assert.equal(result.weakest.status, 'missing');
});

test('a verdict quoting a sentence not in the transcript is rejected (INV-3)', () => {
  const base = {
    criteria: [
      { id: 'problem-clarity', label: 'Problem clarity', score: 20, status: 'missing', excerpt: '', missingSignals: ['evidence'], signals: ['evidence'] },
    ],
  };

  assert.throws(
    () => applySemanticVerdicts(
      base,
      { criteria: [{ id: 'problem-clarity', status: 'covered', span: 'A sentence the student never actually said out loud.', missing: [] }] },
      STARTER_DRAFT,
    ),
    SemanticUnavailable,
    'a fabricated quote must not be accepted as evidence',
  );
});

test('a correct quote still grounds across line breaks and smart punctuation', () => {
  const transcript = 'We reduced preparation time\nby half, and students said—clearly—it helped.';

  // Same words, single-spaced: a model re-flowing a quote is not fabricating.
  assert.equal(normaliseForGrounding('reduced preparation time by half'),
    normaliseForGrounding('reduced preparation  time\nby half'));

  // An em dash typed as a hyphen is the same quote.
  assert.ok(normaliseForGrounding(transcript).includes(normaliseForGrounding('students said-clearly-it helped')));
});

test('a fabricated quote still fails grounding after normalisation', () => {
  const transcript = 'We reduced preparation time by half.';
  assert.ok(!normaliseForGrounding(transcript).includes(normaliseForGrounding('we tripled our revenue')));
});

test('a span too short to be evidence never grounds', () => {
  const base = { criteria: [{ id: 'problem-clarity', label: 'Problem clarity', signals: [], score: 0, status: 'missing', missingSignals: [], excerpt: '' }] };
  const payload = { criteria: [{ id: 'problem-clarity', status: 'covered', span: 'students', missing: [] }] };

  // "students" is in the transcript, but it is 8 characters — too short to
  // support a criterion. With no grounded support left, the whole semantic
  // pass is rejected by the existing fabrication guard rather than credited.
  assert.throws(
    () => applySemanticVerdicts(base, payload, 'Indonesian students prepare alone.'),
    SemanticUnavailable,
  );
});

test('each criterion reports which engine actually answered it', () => {
  const base = {
    criteria: [
      { id: 'a', label: 'A', signals: [], score: 0, status: 'missing', missingSignals: [], excerpt: '' },
      { id: 'b', label: 'B', signals: [], score: 0, status: 'missing', missingSignals: [], excerpt: '' },
    ],
  };
  const transcript = 'Indonesian students rehearse alone without any rubric to check against.';
  const payload = {
    criteria: [
      { id: 'a', status: 'covered', span: 'students rehearse alone without any rubric', missing: [] },
      { id: 'b', status: 'covered', span: 'we have already signed four universities', missing: [] },
    ],
  };

  const result = applySemanticVerdicts(base, payload, transcript);

  assert.equal(result.criteria[0].engine, 'semantic', 'a grounded verdict is semantic');
  assert.equal(result.criteria[1].engine, 'deterministic', 'an ungrounded verdict fell back');
  assert.equal(result.semanticCriteria, 1);
  assert.equal(result.totalCriteria, 2);
});

test('falls back to deterministic when the gateway errors', async () => {
  const result = await analyzeWithSemantics({
    ...INPUT,
    apiKey: 'test-key-not-real',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(result.mode, 'deterministic');
  assert.match(result.degradedReason, /ECONNREFUSED|failed/u);
  assert.equal(result.criteria.length, 4, 'a usable result is still returned');
  assert.ok(result.judgeQuestion.length > 30);
});

test('falls back when the gateway returns a non-200', async () => {
  const result = await analyzeWithSemantics({
    ...INPUT,
    apiKey: 'test-key-not-real',
    fetchImpl: gatewayReturning({}, { ok: false, status: 429 }),
  });
  assert.equal(result.mode, 'deterministic');
  assert.match(result.degradedReason, /429/u);
});

test('falls back when the model returns prose instead of JSON', async () => {
  const result = await analyzeWithSemantics({
    ...INPUT,
    apiKey: 'test-key-not-real',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Sure! Here is my analysis of the pitch.' } }] }),
    }),
  });
  assert.equal(result.mode, 'deterministic');
});

test('falls back when no credentials are configured', async () => {
  const result = await analyzeWithSemantics({ ...INPUT, apiKey: undefined });
  assert.equal(result.mode, 'deterministic');
  assert.equal(result.degradedReason, 'no gateway credentials');
});

test('the gateway is never called without credentials', async () => {
  let called = false;
  await analyzeWithSemantics({
    ...INPUT,
    apiKey: '',
    fetchImpl: async () => { called = true; throw new Error('should not happen'); },
  });
  assert.equal(called, false, 'we must not attempt an unauthenticated call');
});

test('a direct provider never inherits Vercel gateway credentials', () => {
  const credential = selectApiCredential({
    directUrl: 'https://provider.example/v1/chat/completions',
    directKey: undefined,
    gatewayKey: 'gateway-key-not-real',
    oidcToken: 'oidc-token-not-real',
  });

  assert.equal(credential, undefined, 'a custom endpoint must require its explicitly paired key');
});

test('each endpoint selects only its paired credential', () => {
  assert.equal(selectApiCredential({
    directUrl: 'https://provider.example/v1/chat/completions',
    directKey: 'direct-key-not-real',
    gatewayKey: 'gateway-key-not-real',
    oidcToken: 'oidc-token-not-real',
  }), 'direct-key-not-real');

  assert.equal(selectApiCredential({
    directUrl: '',
    directKey: 'direct-key-not-real',
    gatewayKey: 'gateway-key-not-real',
    oidcToken: 'oidc-token-not-real',
  }), 'gateway-key-not-real');
});

test('invalid user input still fails loudly, even in semantic mode (INV-7)', async () => {
  await assert.rejects(
    () => analyzeWithSemantics({ ...INPUT, transcript: '' }),
    /Paste a transcript/u,
  );
});

test('the prompt forbids inventing quotes and names every criterion', () => {
  const messages = buildMessages(STARTER_DRAFT, [
    { id: 'problem-clarity', label: 'Problem clarity', requirementText: 'problem, evidence', signals: ['problem'] },
  ]);
  const system = messages[0].content;
  assert.match(system, /verbatim/iu);
  assert.match(system, /Do not invent a quote/iu);
  assert.match(messages[1].content, /problem-clarity/u);
  assert.match(messages[1].content, /TRANSCRIPT:/u);
});

test('a timeout degrades instead of hanging the demo', async () => {
  const result = await analyzeWithSemantics({
    ...INPUT,
    apiKey: 'test-key-not-real',
    timeoutMs: 20,
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  assert.equal(result.mode, 'deterministic');
  assert.match(result.degradedReason, /timed out/u);
});

// ---------------------------------------------------------------------------
// Provider failover. Availability comes from vendor diversity, so these tests
// exist to prove one vendor going down does not take the demo with it.
// ---------------------------------------------------------------------------

function chainedGateway(behaviour) {
  const seen = [];
  const fetchImpl = async (url, options) => {
    const model = JSON.parse(options.body).model;
    seen.push(model);
    const act = behaviour[model];
    if (act === 'down') throw new Error(`${model} unreachable`);
    if (act === 'prose') {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Certainly! Here is my take.' } }] }) };
    }
    if (act === '429') {
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Free tier requests on this model are rate-limited.' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          criteria: [{ id: 'problem-clarity', status: 'covered', span: REAL_SENTENCE, missing: [], why: 'ok' }],
        }) } }],
      }),
    };
  };
  return { fetchImpl, seen };
}

test('a dead primary vendor fails over to the next vendor', async () => {
  const { fetchImpl, seen } = chainedGateway({ [PRIMARY]: 'down' });
  const result = await analyzeWithSemantics({ ...INPUT, apiKey: 'test-key-not-real', fetchImpl });

  assert.equal(result.mode, 'semantic');
  assert.equal(result.model, SECOND, 'should have moved to the second vendor');
  assert.deepEqual(seen, [PRIMARY, SECOND]);
  assert.equal(result.attempts[0].error, `${PRIMARY} unreachable`);
});

test('rate limiting on two vendors still lands on the third', async () => {
  const { fetchImpl, seen } = chainedGateway({
    [PRIMARY]: '429',
    [SECOND]: 'prose',
  });
  const result = await analyzeWithSemantics({ ...INPUT, apiKey: 'test-key-not-real', fetchImpl });

  assert.equal(result.mode, 'semantic');
  assert.equal(result.model, THIRD);
  assert.equal(seen.length, 3, 'every vendor in the chain should have been tried');
});

test('every vendor down still returns a usable review (INV-8)', async () => {
  const { fetchImpl, seen } = chainedGateway({
    [PRIMARY]: 'down', [SECOND]: 'down', [THIRD]: 'down',
  });
  const result = await analyzeWithSemantics({ ...INPUT, apiKey: 'test-key-not-real', fetchImpl });

  assert.equal(result.mode, 'deterministic');
  assert.equal(seen.length, 3);
  assert.equal(result.criteria.length, 4, 'the student still gets a full review');
  assert.ok(result.judgeQuestion.length > 30, 'and still gets a question to rehearse');
  assert.equal(result.attempts.length, 3);
});

test('the total budget stops the chain rather than stalling the demo', async () => {
  const slow = async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  const started = Date.now();
  const result = await analyzeWithSemantics({
    ...INPUT,
    apiKey: 'test-key-not-real',
    fetchImpl: slow,
    timeoutMs: 60,
    totalBudgetMs: 150,
  });
  const elapsed = Date.now() - started;

  assert.equal(result.mode, 'deterministic');
  assert.ok(elapsed < 1000, `chain should abandon quickly, took ${elapsed}ms`);
});

// The client aborts on its own clock. If it gives up before the server's chain
// budget expires, a successful failover to a second vendor is thrown away and
// the demo silently shows deterministic mode. These two numbers live in
// different files and nothing else keeps them honest.
test('the client waits longer than the server chain can take', () => {
  const clientSource = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
  const match = clientSource.match(/abort\.abort\(\), (\d[\d_]*)\)/u);

  assert.ok(match, 'could not find the client abort timeout in src/app.mjs');
  const clientTimeoutMs = Number(match[1].replace(/_/gu, ''));

  assert.ok(
    clientTimeoutMs > DEFAULT_TOTAL_BUDGET_MS,
    `client aborts at ${clientTimeoutMs}ms but the server chain may run to ${DEFAULT_TOTAL_BUDGET_MS}ms`,
  );
});
