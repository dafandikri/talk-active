import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const brief = readFileSync(join(ROOT, 'brief.html'), 'utf8').replace(/\s+/gu, ' ');

test('product brief explains the problem as a hypothesis and names the initial user', () => {
  assert.match(brief, /The general problem/u);
  assert.match(brief, /Our working hypothesis:/u);
  assert.match(brief, /Indonesian university student/u);
});

test('product brief preserves the complete differentiating loop', () => {
  for (const step of ['Project', 'Rubric', 'Attempt', 'Cited evidence', 'Hardest question', 'Saved progress']) {
    assert.match(brief, new RegExp(`>${step}<`, 'u'), `missing loop step: ${step}`);
  }
  assert.match(brief, /exact transcript span or an explicit list of missing cues/u);
});

test('product brief states current capabilities and honest boundaries', () => {
  assert.match(brief, /deterministic cue matching, not semantic understanding/u);
  assert.match(brief, /not confidence or speaking ability/u);
  assert.match(brief, /Raw audio is not stored/u);
  assert.match(brief, /href="\/#practice"/u);
  assert.match(brief, /href="\/#rubric"/u);
  assert.match(brief, /href="\/#home"/u);
});
