import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MAX_CRITERIA,
  MAX_RUBRIC_CHARS,
  MAX_TRANSCRIPT_CHARS,
} from '../src/analyzer.mjs';
import {
  MAX_CRITERIA as MAX_IMPORTED_CRITERIA,
  MAX_IMPORT_CHARS,
} from '../src/rubric-import.mjs';
import analyzeHandler from '../api/analyze.mjs';
import importHandler from '../api/import-rubric.mjs';

const index = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const app = readFileSync(fileURLToPath(new URL('../src/app.mjs', import.meta.url)), 'utf8');

test('browser fields expose the same prompt ceilings enforced by domain logic', () => {
  assert.match(
    index,
    new RegExp(`id="attemptTranscript"[^>]*maxlength="${MAX_TRANSCRIPT_CHARS}"`, 'u'),
  );
  assert.match(
    index,
    new RegExp(`id="rubricImportInput"[^>]*maxlength="${MAX_RUBRIC_CHARS}"`, 'u'),
  );
  assert.equal(MAX_IMPORT_CHARS, MAX_RUBRIC_CHARS);
  assert.equal(MAX_IMPORTED_CRITERIA, MAX_CRITERIA);
  assert.match(app, /if \(rows >= MAX_CRITERIA\)/u);
});

function responseRecorder() {
  return {
    status: null,
    payload: null,
    writeHead(status) { this.status = status; },
    end(body) { this.payload = JSON.parse(body); },
  };
}

test('pre-parsed Vercel request bodies are rejected before a paid analysis call', async () => {
  const analysisResponse = responseRecorder();
  await analyzeHandler({
    method: 'POST',
    body: {
      transcript: 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1),
      rubricText: 'Problem | evidence',
      durationSeconds: 90,
    },
  }, analysisResponse);
  assert.equal(analysisResponse.status, 400);
  assert.equal(analysisResponse.payload.error, 'transcript_too_long');

  const importResponse = responseRecorder();
  await importHandler({
    method: 'POST',
    body: { rubricText: 'x'.repeat(MAX_RUBRIC_CHARS + 1) },
  }, importResponse);
  assert.equal(importResponse.status, 400);
  assert.equal(importResponse.payload.error, 'rubric_too_long');
});
