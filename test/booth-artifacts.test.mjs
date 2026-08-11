import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(join(ROOT, 'scripts/build-booth-pdf.py'), 'utf8');
const runbook = readFileSync(join(ROOT, 'docs/booth/BOOTH-RUNBOOK.md'), 'utf8');

test('printable booth artifacts exist as single-page A4 and A5 PDFs', () => {
  const expected = [
    ['output/pdf/Talk-Active_Booth_One-Pager_A4.pdf', /595\.\d+ 841\.\d+/u],
    ['output/pdf/Talk-Active_Booth_QR_Card_A5.pdf', /419\.\d+ 595\.\d+/u],
  ];
  for (const [relativePath, mediaBox] of expected) {
    const path = join(ROOT, relativePath);
    assert.equal(existsSync(path), true, `missing ${relativePath}`);
    assert.ok(statSync(path).size > 20_000, `${relativePath} is unexpectedly small`);
    const pdf = readFileSync(path).toString('latin1');
    assert.match(pdf, /^%PDF-/u);
    assert.match(pdf, mediaBox, `${relativePath} has the wrong page size`);
  }
});
test('one-pager source carries the product loop, boundary, team, and production URL', () => {
  for (const phrase of [
    'Bring the rubric.',
    'A supporting verdict disappears if it cannot quote the transcript.',
    'Evidence coverage is not a confidence or speaking-ability score.',
    'Sultan Ibnu Mansiz',
    'https://talk-active-id.vercel.app',
  ]) {
    assert.match(script, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});

test('event runbook protects the official staffing, arrival, and offline-demo obligations', () => {
  assert.match(runbook, /three at the forum and two at the booth/iu);
  assert.match(runbook, /06\.30/u);
  assert.match(runbook, /Wi-Fi physically off/iu);
  assert.match(runbook, /three-phone QR test/iu);
  assert.match(runbook, /Reset demo workspace/u);
});
