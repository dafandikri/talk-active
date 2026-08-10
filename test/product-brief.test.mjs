import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const brief = readFileSync(join(ROOT, 'brief.html'), 'utf8').replace(/\s+/gu, ' ');
const landing = readFileSync(join(ROOT, 'src/landing.css'), 'utf8');

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
  assert.match(brief, /Illustrative evidence trace/u);
  assert.match(brief, /Question tied to the weakest criterion/u);
});

test('product brief states current capabilities and honest boundaries', () => {
  assert.match(brief, /deterministic cue matching, not semantic understanding/u);
  assert.match(brief, /not confidence or speaking ability/u);
  assert.match(brief, /Raw audio is not stored/u);
  assert.match(brief, /href="\/#practice"/u);
  assert.match(brief, /href="\/#home"/u);
});

test('public landing page makes the full-body speaking bird a real character', () => {
  assert.match(brief, /href="\/src\/landing\.css"/u);
  assert.match(brief, /class="landing-mascot"[^>]+cockatoo-mascot-3d\.webp[^>]+alt="Kato, a colorful full-body 3D speaking bird"/u);
  assert.match(brief, /Meet Kato, your rehearsal guide/u);
  assert.match(brief, /Show me the sentence behind that claim/u);
  assert.match(landing, /@keyframes landing-mascot-bob/u);
  assert.match(landing, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(landing, /\.landing-mascot[\s\S]*?animation:\s*none/u);
});

test('numbered landing sections use explanatory assets instead of empty decoration', () => {
  assert.match(brief, /class="landing-gap-asset"[^>]+real rubric becomes a focused rehearsal question/iu);
  assert.match(brief, /src="\/src\/assets\/rehearsal-loop-arrow\.svg"/u);
  assert.match(brief, /class="landing-evidence-stamp"/u);
  assert.match(brief, /class="landing-closing-logo"/u);
  assert.match(landing, /\.landing-gap-asset/u);
  assert.match(landing, /\.landing-loop-arrow/u);
  assert.match(landing, /\.landing-evidence-stamp/u);
});

test('public landing page stays local, truthful, and outside gamified speaking-coach scope', () => {
  assert.doesNotMatch(brief, /https?:\/\//u, 'landing page must not depend on external resources');
  assert.doesNotMatch(brief, /<script\b/iu, 'landing page needs no runtime JavaScript');
  for (const forbidden of ['daily streak', 'pace score', 'tone score', 'confetti', 'social feed', 'share clips']) {
    assert.doesNotMatch(brief, new RegExp(forbidden, 'iu'), `out-of-scope promise leaked into landing page: ${forbidden}`);
  }
});
