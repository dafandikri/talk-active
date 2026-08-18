import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const review = read('apps/web/components/multimodal-review.tsx');
// Copy moved to the catalogues (#36). Structure stays asserted on the
// component; wording is asserted in every locale, which is stricter than the
// English substrings these replace.
const catalogues = ['id', 'en'].map(
  (locale) => JSON.parse(read(`apps/web/messages/${locale}.json`)).multimodalReview,
);
function everyLocaleSays(key, pattern, message) {
  for (const [index, catalogue] of catalogues.entries()) {
    assert.match(catalogue[key] ?? '', pattern, `${message} (${['id', 'en'][index]})`);
  }
}

test('live delivery review keeps rubric context before supporting detail', () => {
  // Order is the product claim — the retake sits above supporting detail — and
  // it is about where markup sits, not what it says. Anchored on message keys
  // now that the words live in the catalogues.
  const retakeAt = review.indexOf("t('fixOneGap')");
  const timelineAt = review.indexOf("t('oneTimeline')");
  const replayAt = review.indexOf("t('replayOnDemand')");
  const detailsAt = review.indexOf("t('deliveryDetails')");
  assert.ok(retakeAt > -1 && timelineAt > -1 && replayAt > -1 && detailsAt > -1);
  assert.ok(retakeAt < timelineAt);
  assert.ok(timelineAt < replayAt);
  assert.ok(replayAt < detailsAt);
});

test('live review uses one labelled clock and keeps the text equivalent on demand', () => {
  assert.match(review, /t\('rubricVoiceCamera'\)/u);
  everyLocaleSays('rubricVoiceCamera', /\S/u, 'the shared clock must be named');
  assert.match(review, /aria-label=\{`Timeline lasting \$\{formatTime\(timelineDurationMs\)\} with rubric, voice, and camera lanes`\}/u);
  assert.match(review, /t\('readAsText'\)/u);
  everyLocaleSays('readAsText', /\S/u, 'the chart must offer a text equivalent');
  assert.match(review, /entry\.evidence\.span/u);
  assert.match(review, /t\('noEvidenceCited'\)/u);
  everyLocaleSays('noEvidenceCited', /\S/u, 'an uncited criterion must say so');
});

test('live review progressively discloses replay, weights, limitations, and raw observations', () => {
  assert.match(review, /<details className="review-disclosure review-replay-disclosure"/u);
  assert.match(review, /<details className="review-disclosure review-full-reading">/u);
  const fullDetailsAt = review.indexOf('review-full-reading');
  assert.ok(review.indexOf('<ReadingComposition', fullDetailsAt) > fullDetailsAt);
  assert.ok(review.indexOf('performance-details', fullDetailsAt) > fullDetailsAt);
  assert.ok(review.indexOf("t('cannotSay')", fullDetailsAt) > fullDetailsAt);
});

test('live review preserves boundaries and text-only user content', () => {
  assert.match(review, /t\('evidenceStaysAbove'\)/u);
  // Delivery never outranks rubric evidence. Saying so only in English would
  // drop the guarantee for the default-locale reader.
  everyLocaleSays('evidenceStaysAbove', /tidak pernah mengubah putusan|never change those verdicts/u,
    'delivery must be stated as unable to change a verdict');
  assert.match(review, /not the speaker/u);
  assert.match(review, /do not measure confidence, ability, truth, emotion/u);
  assert.match(review, /not diagnoses/u);
  assert.doesNotMatch(review, /innerHTML|outerHTML|insertAdjacentHTML/u);
});
