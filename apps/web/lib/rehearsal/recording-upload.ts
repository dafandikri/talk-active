'use client';

import { upload } from '@vercel/blob/client';

import { jsonRequest, requestContract } from '@/lib/api/client';
import {
  RecordingFinalizeResponseSchema,
  RecordingInitResponseSchema,
  type AttemptRecording,
} from '@/lib/contracts';
import type { RehearsalRecording } from './recording';

export interface AttemptRecordingUploadOptions {
  onProgress?: (percentage: number) => void;
}

/**
 * Uploads directly to a private Blob store, then asks our ownership-checked
 * route to verify and finalize the durable recording row. Rubric analysis never
 * depends on this promise succeeding.
 */
export async function uploadAttemptRecording(
  attemptId: string,
  recording: RehearsalRecording,
  options: AttemptRecordingUploadOptions = {},
): Promise<AttemptRecording> {
  const initialized = await requestContract(
    `/api/attempts/${attemptId}/recording`,
    RecordingInitResponseSchema,
    jsonRequest('POST', {
      contentType: recording.mimeType,
      durationMs: Math.max(1, Math.round(recording.durationMs)),
    }),
  );

  const uploaded = await upload(initialized.uploadPathname, recording.blob, {
    access: 'private',
    handleUploadUrl: `/api/attempts/${attemptId}/recording/upload`,
    clientPayload: JSON.stringify({ attemptId }),
    contentType: initialized.recording.contentType,
    multipart: true,
    onUploadProgress: ({ percentage }) => options.onProgress?.(percentage),
  });

  const finalized = await requestContract(
    `/api/attempts/${attemptId}/recording/finalize`,
    RecordingFinalizeResponseSchema,
    jsonRequest('POST', {
      pathname: uploaded.pathname,
      url: uploaded.url,
      contentType: uploaded.contentType,
      sizeBytes: recording.sizeBytes,
      durationMs: Math.max(1, Math.round(recording.durationMs)),
    }),
  );
  return finalized.recording;
}
