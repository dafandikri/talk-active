import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRubricPrompt,
  parseRubricWithSemantics,
} from '../apps/web/lib/ai/rubric-parser.ts';

const SOURCE = `Problem Identification — 15%: Problem framing and urgency. Evidence: problem; urgency.
Technical Execution — 30%: Working implementation and data flow. Evidence: implementation; data flow.
Pitching and Q&A Response — 20%: Clear answers grounded in the demonstrated product.`;

test('M-6 returns traceable, confirmation-ready criteria', async () => {
  const result = await parseRubricWithSemantics(SOURCE, {
    model: 'test/strong-tier',
    generate: async () => ({
      output: {
        criteria: [
          {
            name: 'Problem Identification — 15%',
            description: 'Problem framing and urgency.',
            requiredEvidence: ['problem', 'urgency'],
            sourceExcerpt: 'Problem Identification — 15%: Problem framing and urgency. Evidence: problem; urgency.',
          },
          {
            name: 'Technical Execution — 30%',
            description: 'Working implementation and data flow.',
            requiredEvidence: ['implementation', 'data flow'],
            sourceExcerpt: 'Technical Execution — 30%: Working implementation and data flow. Evidence: implementation; data flow.',
          },
        ],
      },
      modelId: 'test/parser',
    }),
  });

  assert.equal(result.mode, 'semantic');
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.criteria.length, 2);
  assert.equal(
    result.criteria[1].sourceExcerpt,
    'Technical Execution — 30%: Working implementation and data flow. Evidence: implementation; data flow.',
  );
});

test('M-6 retries an invented source excerpt, then accepts a grounded correction', async () => {
  const requests = [];
  const result = await parseRubricWithSemantics(SOURCE, {
    model: 'test/strong-tier',
    generate: async (request) => {
      requests.push(request);
      return requests.length === 1
        ? {
            output: { criteria: [{ name: 'Market', description: '', requiredEvidence: [], sourceExcerpt: 'Market Size — 40%' }] },
            modelId: 'test/parser',
          }
        : {
            output: { criteria: [{
              name: 'Problem Identification — 15%',
              description: 'Problem framing and urgency',
              requiredEvidence: ['problem'],
              sourceExcerpt: 'Problem Identification — 15%: Problem framing and urgency. Evidence: problem; urgency.',
            }] },
            modelId: 'test/parser',
          };
    },
  });

  assert.equal(requests.length, 2);
  assert.match(requests[1].correction, /Market Size/u);
  assert.equal(result.mode, 'semantic');
});

test('M-6 falls back deterministically and still requires confirmation', async () => {
  const result = await parseRubricWithSemantics(SOURCE, {
    model: 'test/strong-tier',
    generate: async () => { throw new Error('provider unavailable'); },
  });
  assert.equal(result.mode, 'deterministic');
  assert.equal(result.criteria.length, 3);
  assert.equal(result.requiresConfirmation, true);
});

test('M-6 prompt explicitly forbids invented criteria', () => {
  assert.match(buildRubricPrompt(SOURCE, null), /Never add/u);
  assert.match(buildRubricPrompt(SOURCE, null), /exact, contiguous quote/u);
});

test('INV-1 rejects a real excerpt that launders invented descriptions or evidence', async () => {
  let calls = 0;
  const result = await parseRubricWithSemantics('Impact — 20%', {
    model: 'test/strong-tier',
    generate: async () => {
      calls += 1;
      return {
        output: {
          criteria: [{
            name: 'Impact — 20%',
            description: 'Must prove nationwide adoption',
            requiredEvidence: ['one million active users'],
            sourceExcerpt: 'Impact — 20%',
          }],
        },
        modelId: 'test/parser',
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.mode, 'deterministic');
  assert.notEqual(result.criteria[0].description, 'Must prove nationwide adoption');
  assert.ok(!result.criteria[0].requiredEvidence.includes('one million active users'));
});

test('A-2 remaps a normalised rubric excerpt to the source characters shown to the user', async () => {
  const source = 'Impact — 20%';
  const result = await parseRubricWithSemantics(source, {
    model: 'test/strong-tier',
    generate: async () => ({
      output: {
        criteria: [{
          name: 'Impact — 20%',
          description: '',
          requiredEvidence: [],
          sourceExcerpt: 'impact - 20%',
        }],
      },
      modelId: 'test/parser',
    }),
  });

  assert.equal(result.criteria[0].sourceExcerpt, source);
});
