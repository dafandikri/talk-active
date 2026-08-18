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
const practiceRoom = read('apps/web/components/practice-room.tsx');
const styles = read('src/styles.css');
const shell = read('apps/web/app/shell.css');

test('live delivery review keeps rubric context before supporting detail', () => {
  // Order is the product claim — the retake sits above supporting detail — and
  // it is about where markup sits, not what it says. Anchored on message keys
  // for the copy, and on the class name for the replay panel, which is
  // structure either way.
  const retakeAt = review.indexOf("t('fixOneGap')");
  const timelineAt = review.indexOf("t('oneTimeline')");
  const replayAt = review.indexOf('review-replay-panel');
  const timelineTextAt = review.indexOf("t('readAsText')");
  const detailsAt = review.indexOf("t('deliveryDetails')");
  assert.ok(
    retakeAt > -1 && timelineAt > -1 && replayAt > -1 && timelineTextAt > -1 && detailsAt > -1,
  );
  assert.ok(timelineAt < replayAt);
  assert.ok(replayAt < timelineTextAt);
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

test('live review shows replay below the timeline and progressively discloses delivery detail', () => {
  assert.match(review, /<section className="review-replay-panel"/u);
  assert.match(review, /<video ref=\{videoRef\} className="recording-player"/u);
  assert.match(review, /<details className="review-disclosure review-full-reading">/u);
  assert.doesNotMatch(review, /Delivery exceptions|review-exception-summary/u);
  assert.doesNotMatch(shell, /review-exception/u);
  const fullDetailsAt = review.indexOf('review-full-reading');
  assert.ok(review.indexOf('<ReadingComposition', fullDetailsAt) > fullDetailsAt);
  assert.ok(review.indexOf('performance-details', fullDetailsAt) > fullDetailsAt);
  assert.ok(review.indexOf("t('cannotSay')", fullDetailsAt) > fullDetailsAt);
});

test('presentation and interview both supply the complete rubric to the shared timeline', () => {
  assert.match(practiceRoom, /buildInterviewRubricTimeline\(/u);
  assert.match(practiceRoom, /interviewTurns\.map\(\(turn\) => \(\{/u);
  assert.match(practiceRoom, /rubricTimeline=\{rubricTimeline\}/u);
  assert.doesNotMatch(practiceRoom, /rubricTimeline=\{rehearsalFormat === 'presentation'/u);
  // Added on main alongside the interview timeline; the sentence moved into
  // the catalogues with the rest of this screen. The claim it pins is that an
  // answer window is reviewed whole, because no word-level time is invented.
  assert.match(review, /t\('answerWindowsOnClock'/u);
  everyLocaleSays('answerWindowsOnClock', /jendela jawaban|answer windows/u,
    'an interview citation must be explained as a whole answer window');
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
