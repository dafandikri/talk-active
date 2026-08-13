import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  normalizeRecordingContentType,
  recordingExpiry,
  recordingExtension,
} from './attempt-recordings.ts';
import {
  AttemptRecordingSchema,
  AttemptReviewResponseSchema,
  RecordingFinalizeRequestSchema,
  SaveAttemptDeliveryReviewRequestSchema,
} from './contracts.ts';

test('recording MIME normalization accepts supported codec forms only', () => {
  assert.equal(normalizeRecordingContentType('video/webm;codecs=vp8,opus'), 'video/webm');
  assert.equal(normalizeRecordingContentType(' VIDEO/MP4 ; codecs="avc1"'), 'video/mp4');
  assert.equal(normalizeRecordingContentType('video/quicktime'), null);
  assert.equal(normalizeRecordingContentType('audio/webm'), null);
  assert.equal(recordingExtension('video/webm'), 'webm');
  assert.equal(recordingExtension('video/mp4'), 'mp4');
});

test('recording expiry is exactly thirty days after initialization', () => {
  assert.equal(
    recordingExpiry(new Date('2026-08-13T00:00:00.000Z')),
    '2026-09-12T00:00:00.000Z',
  );
});

test('delivery events reject reversed timestamps and remain independent of video', () => {
  const base = {
    mode: 'presentation',
    vocalScore: 75,
    visualScore: null,
    trackingCoveragePercent: 55,
    fillerCount: 2,
    repeatedWordCount: 1,
    boundary: 'Observable cues only.',
  } as const;
  assert.equal(SaveAttemptDeliveryReviewRequestSchema.safeParse({ ...base, events: [] }).success, true);
  const result = SaveAttemptDeliveryReviewRequestSchema.safeParse({
    ...base,
    events: [{
      source: 'vision',
      kind: 'body_out_of_frame',
      startMs: 2_000,
      endMs: 1_000,
      label: 'Out of frame',
      evidence: 'Body landmarks were unavailable.',
    }],
  });
  assert.equal(result.success, false);
});

test('public recording metadata excludes private Blob identifiers', () => {
  const parsed = AttemptRecordingSchema.parse({
    id: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    status: 'ready',
    contentType: 'video/webm',
    sizeBytes: MAX_RECORDING_BYTES,
    durationMs: MAX_RECORDING_DURATION_MS,
    expiresAt: '2026-09-12T00:00:00.000Z',
    createdAt: '2026-08-13T00:00:00.000Z',
    uploadedAt: '2026-08-13T00:01:00.000Z',
    blobUrl: 'https://private.example/secret',
    pathname: 'secret/path',
  });
  assert.equal('blobUrl' in parsed, false);
  assert.equal('pathname' in parsed, false);
});

test('finalization enforces duration and size limits', () => {
  const base = {
    pathname: 'attempt-recordings/user/attempt/id.webm',
    url: 'https://example.public.blob.vercel-storage.com/id.webm',
    contentType: 'video/webm;codecs=vp8,opus',
    sizeBytes: 1,
    durationMs: 1,
  };
  assert.equal(RecordingFinalizeRequestSchema.safeParse(base).success, true);
  assert.equal(RecordingFinalizeRequestSchema.safeParse({
    ...base,
    sizeBytes: MAX_RECORDING_BYTES + 1,
  }).success, false);
  assert.equal(RecordingFinalizeRequestSchema.safeParse({
    ...base,
    durationMs: MAX_RECORDING_DURATION_MS + 1,
  }).success, false);
});

test('saved attempt review can retain delivery observations without a recording', () => {
  const attemptId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const result = AttemptReviewResponseSchema.safeParse({
    contractVersion: 2,
    project: {
      id: projectId,
      userId: 'review-owner',
      title: 'Final rehearsal',
      language: 'en-US',
      eventContext: null,
      deadline: null,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
    attempt: {
      id: attemptId,
      projectId,
      mode: 'dictated',
      status: 'review',
      transcript: 'A traceable practice answer.',
      transcriptSource: 'web-speech',
      durationSeconds: 60,
      createdAt: '2026-08-13T00:00:00.000Z',
      completedAt: null,
    },
    deliveryReview: {
      attemptId,
      mode: 'interview',
      vocalScore: 80,
      visualScore: 70,
      trackingCoveragePercent: 90,
      fillerCount: 1,
      repeatedWordCount: 0,
      boundary: 'Observable cues only.',
      createdAt: '2026-08-13T00:00:01.000Z',
    },
    deliveryEvents: [],
    recording: null,
    evidence: [],
  });
  assert.equal(result.success, true);
});
