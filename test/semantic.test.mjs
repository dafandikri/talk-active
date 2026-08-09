// Semantic evidence mapping: the fallback and the grounding rule are the two
// behaviours that decide whether the live demo survives. Both are tested here
// without touching the network.
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_RUBRIC, STARTER_DRAFT } from '../src/analyzer.mjs';
import {
  SemanticUnavailable,
  analyzeWithSemantics,
  applySemanticVerdicts,
  buildMessages,
} from '../src/semantic.mjs';

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
