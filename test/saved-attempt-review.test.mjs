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

test('delivery moments are semantic controls that seek with context', () => {
  assert.match(review, /video\.currentTime = Math\.max\(0, event\.startMs \/ 1_000 - 2\)/u);
  assert.match(review, /<ul className="saved-timeline-list">/u);
  assert.match(review, /<li key=\{event\.id\}>\s*<button/u);
  assert.match(review, /<time dateTime=/u);
  assert.match(review, /disabled=\{!recordingReady\}/u);
});

test('recording deletion is explicit and preserves the saved feedback contract', () => {
  assert.match(review, /recording`,\s*AttemptRecordingDeleteResponseSchema,\s*\{ method: 'DELETE' \}/u);
  assert.match(review, /The transcript, delivery observations, and rubric evidence will remain\./u);
  assert.doesNotMatch(review, /automatically delete|automatically removed/iu);
});

test('synced progress links only attempts with a delivery review or recording state', () => {
  assert.match(progress, /const reviewable = attempt\.hasDeliveryReview \|\| attempt\.recordingStatus !== null;/u);
  assert.match(progress, /href=\{`\/attempts\/\$\{encodeURIComponent\(attempt\.attemptId\)\}`\}/u);
});
