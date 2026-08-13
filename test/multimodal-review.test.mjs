import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const review = read('apps/web/components/multimodal-review.tsx');
const styles = read('src/styles.css');
const shell = read('apps/web/app/shell.css');

test('live delivery review keeps rubric context before supporting detail', () => {
  const retakeAt = review.indexOf('Fix one evidence gap');
  const timelineAt = review.indexOf('One synchronized timeline');
  const replayAt = review.indexOf('review-replay-panel');
  const timelineTextAt = review.indexOf('Read the timeline and cited transcript as text');
  const detailsAt = review.indexOf('Delivery details');
  assert.ok(retakeAt > -1 && timelineAt > -1 && replayAt > -1 && timelineTextAt > -1 && detailsAt > -1);
  assert.ok(retakeAt < timelineAt);
  assert.ok(timelineAt < replayAt);
  assert.ok(replayAt < timelineTextAt);
  assert.ok(replayAt < detailsAt);
});

test('live review uses one labelled clock and keeps the text equivalent on demand', () => {
  assert.match(review, /Rubric, voice, and camera on one clock/u);
  assert.match(review, /aria-label=\{`Timeline lasting \$\{formatTime\(timelineDurationMs\)\} with rubric, voice, and camera lanes`\}/u);
  assert.match(review, /Read the timeline and cited transcript as text/u);
  assert.match(review, /entry\.evidence\.span/u);
  assert.match(review, /No evidence was cited for this criterion\./u);
});

test('live review shows replay below the timeline and progressively discloses delivery detail', () => {
  assert.match(review, /<section className="review-replay-panel"/u);
  assert.match(review, /<video ref=\{videoRef\} className="recording-player"/u);
  assert.match(review, /<details className="review-disclosure review-full-reading">/u);
  assert.doesNotMatch(review, /Delivery exceptions|review-exception-summary/u);
  assert.doesNotMatch(shell, /review-exception/u);
  const fullDetailsAt = review.indexOf('review-full-reading');
  assert.ok(review.indexOf('<ReadingComposition', fullDetailsAt) > fullDetailsAt);
  assert.ok(review.indexOf('performance-details', fullDetailsAt) > fullDetailsAt);
  assert.ok(review.indexOf('What these observations cannot say', fullDetailsAt) > fullDetailsAt);
});

test('every playable live timestamp seeks with context and scrolls the replay into view', () => {
  assert.match(review, /player\.currentTime = Math\.max\(0, startMs \/ 1_000 - 2\)/u);
  assert.match(review, /player\.scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/u);
  assert.equal((review.match(/onClick=\{\(\) => playFrom\(/gu) ?? []).length, 3);
});

test('dense evidence and judge-question copy use the restrained workflow scale', () => {
  assert.match(styles, /\.judge-preview blockquote\s*\{[^}]*font-size:\s*var\(--step-4\);/su);
  assert.match(styles, /\.evidence-quote\s*\{[^}]*font-size:\s*var\(--step-4\);/su);
  assert.match(styles, /\.judge-preview blockquote, \.evidence-quote\s*\{\s*font-size:\s*var\(--step-3\);\s*\}/u);
});

test('live review preserves boundaries and text-only user content', () => {
  assert.match(review, /never change those verdicts/u);
  assert.match(review, /not the speaker/u);
  assert.match(review, /do not measure confidence, ability, truth, emotion/u);
  assert.match(review, /not diagnoses/u);
  assert.doesNotMatch(review, /innerHTML|outerHTML|insertAdjacentHTML/u);
});
