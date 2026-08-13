import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const recordingTools = await import('../apps/web/lib/attempt-recordings.ts');
const contracts = await import('../apps/web/lib/contracts.ts');

test('private recording contracts normalize browser codecs and never expose Blob identifiers', () => {
  assert.equal(
    recordingTools.normalizeRecordingContentType('video/webm;codecs=vp8,opus'),
    'video/webm',
  );
  assert.equal(recordingTools.normalizeRecordingContentType('video/mp4; codecs=avc1'), 'video/mp4');
  assert.equal(recordingTools.normalizeRecordingContentType('video/quicktime'), null);

  const recording = contracts.AttemptRecordingSchema.parse({
    id: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    status: 'ready',
    contentType: 'video/webm',
    sizeBytes: 25_000,
    durationMs: 4_000,
    expiresAt: '2026-09-12T00:00:00.000Z',
    createdAt: '2026-08-13T00:00:00.000Z',
    uploadedAt: '2026-08-13T00:00:05.000Z',
    blobUrl: 'https://private.example/secret',
    pathname: 'attempt-recordings/secret.webm',
  });
  assert.equal('blobUrl' in recording, false);
  assert.equal('pathname' in recording, false);
});

test('delivery observations save without video and reject an impossible timeline', () => {
  const base = {
    mode: 'presentation',
    vocalScore: 76,
    visualScore: null,
    trackingCoveragePercent: 45,
    fillerCount: 2,
    repeatedWordCount: 1,
    boundary: 'Observable rehearsal cues only.',
  };
  assert.equal(contracts.SaveAttemptDeliveryReviewRequestSchema.safeParse({
    ...base,
    events: [],
  }).success, true);
  assert.equal(contracts.SaveAttemptDeliveryReviewRequestSchema.safeParse({
    ...base,
    events: [{
      source: 'vision',
      kind: 'body_out_of_frame',
      startMs: 9_000,
      endMs: 8_000,
      label: 'Out of frame',
      evidence: 'Body landmarks were unavailable.',
    }],
  }).success, false);
});

test('recording routes require ownership and proxy private media instead of returning a Blob URL', async () => {
  const service = await readFile('apps/web/lib/services/attempt-recordings.ts', 'utf8');
  const initRoute = await readFile('apps/web/app/api/attempts/[id]/recording/route.ts', 'utf8');
  const reviewRoute = await readFile('apps/web/app/api/attempts/[id]/review/route.ts', 'utf8');
  const mediaRoute = await readFile('apps/web/app/api/attempts/[id]/recording/media/route.ts', 'utf8');
  const uploadRoute = await readFile('apps/web/app/api/attempts/[id]/recording/upload/route.ts', 'utf8');

  assert.match(initRoute, /requireUserId\(request\)/u);
  assert.match(reviewRoute, /requireUserId\(request\)/u);
  assert.match(mediaRoute, /requireUserId\(request\)/u);
  assert.match(service, /innerJoin\(projects,[\s\S]*eq\(projects\.userId, userId\)/u);
  assert.match(service, /allowedContentTypes: \['video\/webm', 'video\/mp4'\]/u);
  assert.doesNotMatch(service, /allowedContentTypes:[^\n]*video\/\*/u);
  assert.match(uploadRoute, /handleUpload\(/u);
  assert.match(uploadRoute, /onUploadCompleted/u);
  assert.match(mediaRoute, /content-range/u);
  assert.doesNotMatch(mediaRoute, /blobUrl/u);
});

test('schema and upload token enforce bounded private replay retention', async () => {
  const schema = await readFile('apps/web/lib/db/schema.ts', 'utf8');
  const service = await readFile('apps/web/lib/services/attempt-recordings.ts', 'utf8');
  assert.match(schema, /250000000/u);
  assert.match(schema, /3600000/u);
  assert.match(service, /recordingExpiry\(\)/u);
  assert.match(service, /tokenPayload: encodeRecordingUploadToken/u);
  assert.match(service, /recording\.blobUrl \?\? recording\.pathname/u);
});
