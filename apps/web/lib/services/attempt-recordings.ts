import { and, asc, eq } from 'drizzle-orm';

import { ApiProblem, notFound } from '../api/http';
import {
  AttemptRecordingDeleteResponseSchema,
  AttemptRecordingSchema,
  AttemptReviewResponseSchema,
  CONTRACT_VERSION,
  RecordingFinalizeResponseSchema,
  RecordingInitResponseSchema,
  SaveAttemptDeliveryReviewResponseSchema,
  type RecordingFinalizeRequest,
  type RecordingInitRequest,
  type SaveAttemptDeliveryReviewRequest,
} from '../contracts';
import type { Database } from '../db/client';
import {
  attemptDeliveryEvents,
  attemptDeliveryReviews,
  attemptRecordings,
  attempts,
  criteria,
  evidenceVerdicts,
  projects,
} from '../db/schema';
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  RecordingStorageError,
  normalizeRecordingContentType,
  recordingExpiry,
  recordingExtension,
  type RecordingBlobStream,
  type RecordingStorage,
  vercelRecordingStorage,
} from '../attempt-recordings';

function now(): string {
  return new Date().toISOString();
}

function publicRecording(row: typeof attemptRecordings.$inferSelect) {
  return AttemptRecordingSchema.parse({
    id: row.id,
    attemptId: row.attemptId,
    status: row.status,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    uploadedAt: row.uploadedAt,
  });
}

function throwStorageProblem(error: unknown): never {
  if (error instanceof RecordingStorageError) {
    throw new ApiProblem(503, error.code, error.message, true);
  }
  throw new ApiProblem(
    503,
    'recording_storage_unavailable',
    'Private attempt-recording storage could not complete the request.',
    true,
  );
}

export async function assertOwnedAttempt(
  db: Database,
  attemptId: string,
  userId: string,
) {
  const [attempt] = await db.select({ attempt: attempts })
    .from(attempts)
    .innerJoin(projects, eq(projects.id, attempts.projectId))
    .where(and(eq(attempts.id, attemptId), eq(projects.userId, userId)))
    .limit(1);
  if (!attempt) notFound('Attempt');
  return attempt.attempt;
}

export async function saveAttemptDeliveryReview(
  db: Database,
  attemptId: string,
  input: SaveAttemptDeliveryReviewRequest,
  userId: string,
) {
  await assertOwnedAttempt(db, attemptId, userId);
  const result = await db.transaction(async (tx) => {
    const [deliveryReview] = await tx.insert(attemptDeliveryReviews).values({
      attemptId,
      mode: input.mode,
      vocalScore: input.vocalScore,
      visualScore: input.visualScore,
      trackingCoveragePercent: input.trackingCoveragePercent,
      fillerCount: input.fillerCount,
      repeatedWordCount: input.repeatedWordCount,
      boundary: input.boundary,
    }).onConflictDoUpdate({
      target: attemptDeliveryReviews.attemptId,
      set: {
        mode: input.mode,
        vocalScore: input.vocalScore,
        visualScore: input.visualScore,
        trackingCoveragePercent: input.trackingCoveragePercent,
        fillerCount: input.fillerCount,
        repeatedWordCount: input.repeatedWordCount,
        boundary: input.boundary,
        createdAt: now(),
      },
    }).returning();
    if (!deliveryReview) throw new Error('The delivery-review insert returned no row.');
    await tx.delete(attemptDeliveryEvents).where(eq(attemptDeliveryEvents.attemptId, attemptId));
    const deliveryEvents = input.events.length > 0
      ? await tx.insert(attemptDeliveryEvents).values(input.events.map((event) => ({
        attemptId,
        ...event,
      }))).returning()
      : [];
    return { deliveryReview, deliveryEvents };
  });
  return SaveAttemptDeliveryReviewResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    ...result,
  });
}

export async function getAttemptReview(db: Database, attemptId: string, userId: string) {
  const attempt = await assertOwnedAttempt(db, attemptId, userId);
  const [projectRows, reviewRows, deliveryEvents, recordingRows, evidence] = await Promise.all([
    db.select().from(projects)
      .where(and(eq(projects.id, attempt.projectId), eq(projects.userId, userId)))
      .limit(1),
    db.select().from(attemptDeliveryReviews)
      .where(eq(attemptDeliveryReviews.attemptId, attemptId)).limit(1),
    db.select().from(attemptDeliveryEvents)
      .where(eq(attemptDeliveryEvents.attemptId, attemptId))
      .orderBy(asc(attemptDeliveryEvents.startMs), asc(attemptDeliveryEvents.createdAt)),
    db.select().from(attemptRecordings)
      .where(eq(attemptRecordings.attemptId, attemptId)).limit(1),
    db.select({
      criterionId: criteria.id,
      criterionName: criteria.name,
      verdict: evidenceVerdicts.verdict,
      coverageScore: evidenceVerdicts.coverageScore,
      citedSpan: evidenceVerdicts.citedSpan,
      missingEvidence: evidenceVerdicts.missingEvidence,
    }).from(evidenceVerdicts)
      .innerJoin(criteria, eq(criteria.id, evidenceVerdicts.criterionId))
      .where(and(
        eq(evidenceVerdicts.attemptId, attemptId),
        eq(evidenceVerdicts.stage, 'initial'),
      ))
      .orderBy(asc(criteria.displayOrder)),
  ]);
  return AttemptReviewResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    project: projectRows[0],
    attempt,
    deliveryReview: reviewRows[0] ?? null,
    deliveryEvents,
    recording: recordingRows[0] ? publicRecording(recordingRows[0]) : null,
    evidence,
  });
}

export async function initializeAttemptRecording(
  db: Database,
  attemptId: string,
  input: RecordingInitRequest,
  userId: string,
) {
  await assertOwnedAttempt(db, attemptId, userId);
  const contentType = normalizeRecordingContentType(input.contentType);
  if (!contentType) {
    throw new ApiProblem(400, 'unsupported_recording_type', 'Use a WebM or MP4 attempt recording.');
  }
  const existing = await db.select().from(attemptRecordings)
    .where(eq(attemptRecordings.attemptId, attemptId)).limit(1);
  if (existing.length > 0) {
    throw new ApiProblem(409, 'recording_already_initialized', 'This attempt already has a recording slot.');
  }
  const id = crypto.randomUUID();
  const uploadPathname = `attempt-recordings/${userId}/${attemptId}/${id}.${recordingExtension(contentType)}`;
  const [recording] = await db.insert(attemptRecordings).values({
    id,
    attemptId,
    status: 'pending',
    pathname: uploadPathname,
    contentType,
    durationMs: input.durationMs,
    expiresAt: recordingExpiry(),
  }).onConflictDoNothing().returning();
  if (!recording) {
    throw new ApiProblem(409, 'recording_already_initialized', 'This attempt already has a recording slot.');
  }
  return RecordingInitResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    recording: publicRecording(recording),
    uploadPathname,
  });
}

interface UploadTokenPayload {
  attemptId: string;
  userId: string;
  pathname: string;
}

export function encodeRecordingUploadToken(input: UploadTokenPayload): string {
  return JSON.stringify(input);
}

export function decodeRecordingUploadToken(value: string | null | undefined): UploadTokenPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? '');
  } catch {
    throw new ApiProblem(400, 'invalid_upload_token', 'The recording upload token is invalid.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ApiProblem(400, 'invalid_upload_token', 'The recording upload token is invalid.');
  }
  const candidate = parsed as Partial<UploadTokenPayload>;
  if (!candidate.attemptId || !candidate.userId || !candidate.pathname) {
    throw new ApiProblem(400, 'invalid_upload_token', 'The recording upload token is incomplete.');
  }
  return {
    attemptId: candidate.attemptId,
    userId: candidate.userId,
    pathname: candidate.pathname,
  };
}

export async function authorizeAttemptRecordingUpload(
  db: Database,
  attemptId: string,
  userId: string,
  pathname: string,
  clientPayload: string | null,
) {
  let requestedAttemptId: unknown;
  try {
    requestedAttemptId = JSON.parse(clientPayload ?? '').attemptId;
  } catch {
    throw new ApiProblem(400, 'invalid_upload_payload', 'The recording upload payload is invalid.');
  }
  if (requestedAttemptId !== attemptId) {
    throw new ApiProblem(400, 'recording_attempt_mismatch', 'The upload does not match this attempt.');
  }
  await assertOwnedAttempt(db, attemptId, userId);
  const [recording] = await db.select().from(attemptRecordings).where(and(
    eq(attemptRecordings.attemptId, attemptId),
    eq(attemptRecordings.pathname, pathname),
    eq(attemptRecordings.status, 'pending'),
  )).limit(1);
  if (!recording) notFound('Pending attempt recording');
  return {
    allowedContentTypes: ['video/webm', 'video/mp4'] as string[],
    maximumSizeInBytes: MAX_RECORDING_BYTES,
    validUntil: Date.now() + 60 * 60 * 1_000,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    tokenPayload: encodeRecordingUploadToken({ attemptId, userId, pathname }),
  };
}

async function finalizeKnownRecording(
  db: Database,
  attemptId: string,
  input: RecordingFinalizeRequest,
) {
  const contentType = normalizeRecordingContentType(input.contentType);
  if (!contentType) {
    throw new ApiProblem(400, 'unsupported_recording_type', 'The uploaded recording is not WebM or MP4.');
  }
  if (input.durationMs > MAX_RECORDING_DURATION_MS || input.sizeBytes > MAX_RECORDING_BYTES) {
    throw new ApiProblem(413, 'recording_too_large', 'The attempt recording exceeds its upload limit.');
  }
  const [recording] = await db.select().from(attemptRecordings)
    .where(eq(attemptRecordings.attemptId, attemptId)).limit(1);
  if (!recording) notFound('Attempt recording');
  if (recording.pathname !== input.pathname || recording.durationMs !== input.durationMs) {
    throw new ApiProblem(409, 'recording_metadata_mismatch', 'The upload does not match its initialized recording.');
  }
  if (recording.contentType !== contentType) {
    throw new ApiProblem(409, 'recording_type_mismatch', 'The recording content type changed during upload.');
  }
  if (recording.status === 'ready') {
    if (recording.blobUrl === input.url && recording.sizeBytes === input.sizeBytes) {
      return recording;
    }
    throw new ApiProblem(409, 'recording_already_finalized', 'The recording was already finalized differently.');
  }
  const [saved] = await db.update(attemptRecordings).set({
    status: 'ready',
    blobUrl: input.url,
    sizeBytes: input.sizeBytes,
    uploadedAt: now(),
  }).where(and(
    eq(attemptRecordings.id, recording.id),
    eq(attemptRecordings.status, 'pending'),
  )).returning();
  if (!saved) throw new ApiProblem(409, 'recording_finalize_conflict', 'The recording state changed while finalizing.');
  return saved;
}

export async function finalizeAttemptRecording(
  db: Database,
  attemptId: string,
  input: RecordingFinalizeRequest,
  userId: string,
  storage: RecordingStorage = vercelRecordingStorage,
) {
  await assertOwnedAttempt(db, attemptId, userId);
  const [pending] = await db.select().from(attemptRecordings)
    .where(eq(attemptRecordings.attemptId, attemptId)).limit(1);
  if (!pending) notFound('Attempt recording');
  if (pending.pathname !== input.pathname) {
    throw new ApiProblem(409, 'recording_path_mismatch', 'The upload path does not match this recording.');
  }
  let inspected: Awaited<ReturnType<RecordingStorage['inspect']>>;
  try {
    inspected = await storage.inspect(input.pathname);
  } catch (error) {
    throwStorageProblem(error);
  }
  const inspectedType = normalizeRecordingContentType(inspected.contentType);
  if (
    inspected.pathname !== input.pathname
    || inspected.url !== input.url
    || inspected.sizeBytes !== input.sizeBytes
    || inspectedType !== normalizeRecordingContentType(input.contentType)
  ) {
    throw new ApiProblem(409, 'recording_blob_mismatch', 'Stored recording metadata does not match the upload result.');
  }
  const recording = await finalizeKnownRecording(db, attemptId, {
    ...input,
    contentType: inspected.contentType,
    sizeBytes: inspected.sizeBytes,
    url: inspected.url,
    pathname: inspected.pathname,
  });
  return RecordingFinalizeResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    recording: publicRecording(recording),
  });
}

export async function completeAttemptRecordingFromUpload(
  db: Database,
  tokenPayload: string | null | undefined,
  blob: { pathname: string; url: string; contentType: string },
  storage: RecordingStorage = vercelRecordingStorage,
) {
  const token = decodeRecordingUploadToken(tokenPayload);
  if (token.pathname !== blob.pathname) {
    throw new ApiProblem(400, 'recording_path_mismatch', 'The completed upload path is invalid.');
  }
  const metadata = await storage.inspect(blob.pathname).catch(throwStorageProblem);
  await finalizeKnownRecording(db, token.attemptId, {
    pathname: metadata.pathname,
    url: metadata.url,
    contentType: metadata.contentType,
    sizeBytes: metadata.sizeBytes,
    durationMs: (await db.select({ durationMs: attemptRecordings.durationMs })
      .from(attemptRecordings)
      .where(and(
        eq(attemptRecordings.attemptId, token.attemptId),
        eq(attemptRecordings.pathname, token.pathname),
      )).limit(1))[0]?.durationMs ?? 0,
  });
}

export async function deleteAttemptRecording(
  db: Database,
  attemptId: string,
  userId: string,
  storage: RecordingStorage = vercelRecordingStorage,
) {
  await assertOwnedAttempt(db, attemptId, userId);
  const [recording] = await db.select().from(attemptRecordings)
    .where(eq(attemptRecordings.attemptId, attemptId)).limit(1);
  if (!recording) notFound('Attempt recording');
  try {
    await storage.delete([recording.blobUrl ?? recording.pathname]);
  } catch (error) {
    // A pending initialization might not have created a Blob yet. Metadata can
    // still be removed; ready recordings fail loudly to avoid orphaning data.
    if (recording.status === 'ready') throwStorageProblem(error);
  }
  await db.delete(attemptRecordings).where(eq(attemptRecordings.id, recording.id));
  return AttemptRecordingDeleteResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    deleted: true,
  });
}

export async function readAttemptRecording(
  db: Database,
  attemptId: string,
  userId: string,
  range: string | undefined,
  storage: RecordingStorage = vercelRecordingStorage,
): Promise<RecordingBlobStream> {
  await assertOwnedAttempt(db, attemptId, userId);
  const [recording] = await db.select().from(attemptRecordings).where(and(
    eq(attemptRecordings.attemptId, attemptId),
    eq(attemptRecordings.status, 'ready'),
  )).limit(1);
  if (!recording?.blobUrl) notFound('Ready attempt recording');
  if (new Date(recording.expiresAt).getTime() <= Date.now()) {
    throw new ApiProblem(410, 'recording_expired', 'This replay has reached its retention date.');
  }
  try {
    return await storage.read(recording.blobUrl, range);
  } catch (error) {
    throwStorageProblem(error);
  }
}
