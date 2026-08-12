import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  boundedSourceMaterials,
  MAX_SOURCE_BYTES,
  safeSourceFilename,
  validateSourceUpload,
} from '../apps/web/lib/source-documents.ts';

function sourceUpload(name, type, content, declaredSize) {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    type,
    size: declaredSize ?? bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  };
}

test('A-6 validates bounded UTF-8 source files and strips path traversal from their names', async () => {
  const validated = await validateSourceUpload(sourceUpload(
    '../../proposal notes.md',
    'text/markdown',
    '# Evidence\nInterviewed 40 students across three campuses.',
  ));
  assert.equal(validated.filename, 'proposal notes.md');
  assert.equal(validated.contentType, 'text/markdown');
  assert.match(validated.content, /40 students/u);
  assert.equal(safeSourceFilename('..\\private\\claims.json'), 'claims.json');
});

test('A-6 rejects binary, malformed JSON, unsupported types, and oversized sources loudly', async () => {
  await assert.rejects(
    validateSourceUpload(sourceUpload('claims.json', 'application/json', '{not-valid-json-but-long-enough}')),
    /not valid JSON/u,
  );
  await assert.rejects(
    validateSourceUpload(sourceUpload('slides.pdf', 'application/pdf', 'not really a PDF but unsupported')),
    /UTF-8 \.txt/u,
  );
  await assert.rejects(
    validateSourceUpload(sourceUpload('large.txt', 'text/plain', 'Readable source material.', MAX_SOURCE_BYTES + 1)),
    /40 KB/u,
  );
  const binary = new Uint8Array([0xff, 0xfe, 0xfd]);
  await assert.rejects(validateSourceUpload({
    name: 'binary.txt', type: 'text/plain', size: binary.byteLength,
    arrayBuffer: async () => binary.buffer,
  }), /valid UTF-8/u);
});

test('A-6 bounds aggregate source context without inventing content', () => {
  const materials = boundedSourceMaterials([
    { id: 'one', filename: 'one.txt', content: 'a'.repeat(60_000) },
    { id: 'two', filename: 'two.txt', content: 'b'.repeat(60_000) },
  ]);
  assert.equal(materials.reduce((sum, item) => sum + item.content.length, 0), 80_000);
  assert.equal(materials[0].content, 'a'.repeat(60_000));
  assert.equal(materials[1].content, 'b'.repeat(20_000));
});

test('A-6 private storage adapter never uploads a public source document', async () => {
  const source = await readFile('apps/web/lib/source-documents.ts', 'utf8');
  assert.match(source, /put\([\s\S]+access: 'private'/u);
  assert.match(source, /get\([\s\S]+access: 'private'/u);
  assert.doesNotMatch(source, /access: 'public'/u);
});
