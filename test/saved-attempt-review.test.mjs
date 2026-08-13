import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const review = read('apps/web/components/saved-attempt-review.tsx');
const progress = read('apps/web/components/progress-view.tsx');
const page = read('apps/web/app/attempts/[id]/page.tsx');

test('saved attempt page keeps the review inside the authenticated workspace shell', () => {
  assert.match(page, /<WorkspaceFrame>\s*<SavedAttemptReview attemptId=\{id\} \/>\s*<\/WorkspaceFrame>/u);
});

test('saved review uses the private review and media routes without exposing a blob URL', () => {
  assert.match(review, /requestContract\(`\/api\/attempts\/\$\{encodeURIComponent\(attemptId\)\}\/review`, AttemptReviewResponseSchema/u);
  assert.match(review, /src=\{`\/api\/attempts\/\$\{encodeURIComponent\(attemptId\)\}\/recording\/media`\}/u);
  assert.doesNotMatch(review, /blobUrl|pathname/u);
});

test('saved review is evidence-first and keeps an explicit way back', () => {
  assert.match(review, /const progressHref = `\/progress\?project=\$\{encodeURIComponent\(review\.project\.id\)\}`/u);
  assert.match(review, /href=\{progressHref\}[^>]*>.*Back to progress/u);
  const evidenceAt = review.indexOf('Rubric evidence');
  const timelineAt = review.indexOf('One synchronized timeline');
  const replayAt = review.indexOf('Private replay');
  const deliveryAt = review.indexOf('Delivery details');
  assert.ok(evidenceAt > -1 && timelineAt > -1 && replayAt > -1 && deliveryAt > -1);
  assert.ok(evidenceAt < timelineAt, 'rubric evidence must precede the timeline');
  assert.ok(timelineAt < replayAt, 'the shared timeline must precede replay');
  assert.ok(replayAt < deliveryAt, 'replay must precede delivery detail');
});

test('exact quotes and missing cues stay visible while raw observations are disclosed', () => {
  assert.match(review, /item\.citedSpan/u);
  assert.match(review, /item\.missingEvidence\.map/u);
  assert.match(review, /No transcript span supports this verdict\./u);
  assert.match(review, /<details className="saved-disclosure saved-timeline-disclosure">/u);
  assert.match(review, /<details className="surface saved-disclosure saved-replay-card"/u);
  assert.match(review, /<details className="surface saved-disclosure saved-delivery-summary">/u);
  assert.doesNotMatch(review, /<ul className="saved-timeline-list">[\s\S]*<\/section>[\s\S]*<ul className="saved-timeline-list">/u);
});

test('saved detail does not expose aggregate delivery scores after their component math is discarded', () => {
  assert.doesNotMatch(review, /delivery\.(?:vocalScore|visualScore)/u);
  assert.match(review, /does not retain the component bands needed to defend an aggregate delivery reading/u);
  assert.match(review, /no vocal, visual, or overall score is shown/u);
});

test('delivery moments are semantic controls that seek with context', () => {
  assert.match(review, /video\.currentTime = Math\.max\(0, event\.startMs \/ 1_000 - 2\)/u);
  assert.match(review, /<ul className="saved-timeline-list">/u);
  assert.match(review, /<li key=\{event\.id\}>\s*<button/u);
  assert.match(review, /<time dateTime=/u);
  assert.match(review, /disabled=\{!recordingReady\}/u);
  assert.match(review, /aria-label=\{`Timeline lasting \$\{formatClock\(timelineDurationMs\)\} with rubric, voice, and camera lanes`\}/u);
});

test('recording deletion is explicit and preserves the saved feedback contract', () => {
  assert.match(review, /recording`,\s*AttemptRecordingDeleteResponseSchema,\s*\{ method: 'DELETE' \}/u);
  assert.match(review, /The transcript, delivery observations, and rubric evidence will remain\./u);
  assert.doesNotMatch(review, /automatically delete|automatically removed/iu);
});

test('synced progress links only attempts with a delivery review or recording state', () => {
  assert.match(progress, /const reviewable = attempt\.hasDeliveryReview \|\| attempt\.recordingStatus !== null;/u);
  assert.match(progress, /href=\{`\/attempts\/\$\{encodeURIComponent\(attempt\.attemptId\)\}/u);
});

// Leaving the project behind on the way into an attempt is how a user lands
// back on somebody else's history when they press Back. The selected project
// rides along in the query so the return trip restores the same workspace.
test('an attempt link carries the selected project so the way back is unambiguous', () => {
  assert.match(
    progress,
    /href=\{`\/attempts\/\$\{encodeURIComponent\(attempt\.attemptId\)\}\$\{progressProjectId \? `\?project=\$\{encodeURIComponent\(progressProjectId\)\}` : ''\}`\}/u,
  );
});
