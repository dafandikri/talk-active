import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const booth = readFileSync(join(ROOT, 'booth.html'), 'utf8').replace(/\s+/gu, ' ');
const styles = readFileSync(join(ROOT, 'src/booth.css'), 'utf8');
const qr = readFileSync(join(ROOT, 'src/assets/talk-active-production-qr.svg'), 'utf8');

test('booth display communicates the differentiating loop without a presenter', () => {
  assert.match(booth, /Bring the rubric/u);
  assert.match(booth, /Find the sentence/u);
  for (const step of ['Paste the rubric', 'Rehearse once', 'Inspect the quote', 'Defend the gap']) {
    assert.match(booth, new RegExp(step, 'u'));
  }
  assert.match(booth, /No quote[^<]*<\/strong> No supporting verdict/iu);
  assert.match(booth, /Evidence coverage[^<]*not confidence or speaking ability/iu);
});
test('booth display contains official identity and a local production QR', () => {
  assert.match(booth, /ristek-hackathon-2026-logo\.png/u);
  assert.match(booth, /GRAND FINAL · TEAM FAM/u);
  assert.match(booth, /talk-active-production-qr\.svg/u);
  assert.match(booth, /talk-active-id\.vercel\.app/u);
  assert.match(qr, /<svg/u);
});

test('booth display is static, self-contained, and designed for a 16:9 screen', () => {
  assert.doesNotMatch(booth, /<script\b/iu);
  assert.doesNotMatch(booth, /(?:src|href)="https?:\/\//iu);
  assert.match(styles, /height:\s*100vh/u);
  assert.match(styles, /overflow:\s*hidden/u);
  assert.match(styles, /@media \(max-aspect-ratio: 4 \/ 3\)/u);
});
