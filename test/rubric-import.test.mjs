// Rubric import is the hero moment: a judge pastes their own scoring matrix
// on stage. It must produce something usable or degrade to the manual editor
// with the raw text intact — it must never block starting a project.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRubric } from '../src/analyzer.mjs';
import { buildImportMessages, parseImportedRubric } from '../src/rubric-import.mjs';

test('a well-formed model response becomes rubric lines the parser accepts', () => {
  const payload = {
    criteria: [
      { label: 'Technical Execution', cues: ['prototype', 'architecture', 'works live'] },
      { label: 'Pitching and Q&A', cues: ['clarity', 'handles questions'] },
    ],
  };

  const text = parseImportedRubric(payload);
  assert.equal(text, 'Technical Execution | prototype, architecture, works live\nPitching and Q&A | clarity, handles questions');

  // The real contract: whatever we emit must survive the existing parser.
  const parsed = parseRubric(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].label, 'Technical Execution');
});

test('a response with no usable criteria is rejected rather than half-imported', () => {
  assert.throws(() => parseImportedRubric({ criteria: [] }), /no criteria/u);
  assert.throws(() => parseImportedRubric({}), /no criteria/u);
  assert.throws(() => parseImportedRubric({ criteria: [{ cues: ['x'] }] }), /no criteria/u);
});

test('the prompt forbids inventing criteria and names the source text', () => {
  const messages = buildImportMessages('Technical Execution 30%\nPitching 20%');
  const system = messages.find((message) => message.role === 'system').content;

  assert.match(system, /only.*criteria.*present/iu);
  assert.ok(messages.some((message) => message.content.includes('Technical Execution 30%')));
});

test('an oversized paste fails loudly instead of being truncated', () => {
  assert.throws(() => buildImportMessages('x'.repeat(9000)), /too long/u);
});
