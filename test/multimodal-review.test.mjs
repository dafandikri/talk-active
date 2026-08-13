import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const review = read('apps/web/components/multimodal-review.tsx');

test('live delivery review keeps rubric context before supporting detail', () => {
  const retakeAt = review.indexOf('Fix one evidence gap');
  const timelineAt = review.indexOf('One synchronized timeline');
  const replayAt = review.indexOf('Replay on demand');
  const detailsAt = review.indexOf('Delivery details');
  assert.ok(retakeAt > -1 && timelineAt > -1 && replayAt > -1 && detailsAt > -1);
  assert.ok(retakeAt < timelineAt);
  assert.ok(timelineAt < replayAt);
  assert.ok(replayAt < detailsAt);
});

test('live review uses one labelled clock and keeps the text equivalent on demand', () => {
  assert.match(review, /Rubric, voice, and camera on one clock/u);
  assert.match(review, /aria-label=\{`Timeline lasting \$\{formatTime\(timelineDurationMs\)\} with rubric, voice, and camera lanes`\}/u);
  assert.match(review, /Read the timeline and cited transcript as text/u);
  assert.match(review, /entry\.evidence\.span/u);
  assert.match(review, /No evidence was cited for this criterion\./u);
});

test('live review progressively discloses replay, weights, limitations, and raw observations', () => {
  assert.match(review, /<details className="review-disclosure review-replay-disclosure"/u);
  assert.match(review, /<details className="review-disclosure review-full-reading">/u);
  const fullDetailsAt = review.indexOf('review-full-reading');
  assert.ok(review.indexOf('<ReadingComposition', fullDetailsAt) > fullDetailsAt);
  assert.ok(review.indexOf('performance-details', fullDetailsAt) > fullDetailsAt);
  assert.ok(review.indexOf('What these observations cannot say', fullDetailsAt) > fullDetailsAt);
});

test('live review preserves boundaries and text-only user content', () => {
  assert.match(review, /never change those verdicts/u);
  assert.match(review, /not the speaker/u);
  assert.match(review, /do not measure confidence, ability, truth, emotion/u);
  assert.match(review, /not diagnoses/u);
  assert.doesNotMatch(review, /innerHTML|outerHTML|insertAdjacentHTML/u);
});
