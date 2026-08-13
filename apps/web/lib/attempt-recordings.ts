import { del, get, head } from '@vercel/blob';

export const MAX_RECORDING_BYTES = 250_000_000;
export const MAX_RECORDING_DURATION_MS = 3_600_000;
export const RECORDING_RETENTION_DAYS = 30;

export type RecordingContentType = 'video/webm' | 'video/mp4';

export interface RecordingBlobMetadata {
  url: string;
  pathname: string;
  contentType: string;
  sizeBytes: number;
}

export interface RecordingBlobStream extends RecordingBlobMetadata {
  stream: ReadableStream<Uint8Array>;
  headers: Headers;
}

export interface RecordingStorage {
  inspect(reference: string): Promise<RecordingBlobMetadata>;
  read(reference: string, range?: string): Promise<RecordingBlobStream>;
  delete(references: string[]): Promise<void>;
}

export class RecordingStorageError extends Error {
  readonly code: 'recording_storage_unavailable' | 'recording_blob_unavailable';

  constructor(
    code: 'recording_storage_unavailable' | 'recording_blob_unavailable',
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'RecordingStorageError';
    this.code = code;
  }
}

/** MediaRecorder adds codec parameters; persistence uses the stable MIME base. */
export function normalizeRecordingContentType(value: unknown): RecordingContentType | null {
  const base = String(value ?? '').split(';', 1)[0]?.trim().toLocaleLowerCase('en-US');
  return base === 'video/webm' || base === 'video/mp4' ? base : null;
}

export function recordingExtension(contentType: RecordingContentType): 'webm' | 'mp4' {
  return contentType === 'video/webm' ? 'webm' : 'mp4';
}

export function recordingExpiry(from = new Date()): string {
  return new Date(from.getTime() + RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
}

function assertStorageConfigured(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    throw new RecordingStorageError(
      'recording_storage_unavailable',
      'Private attempt-recording storage is not configured on this deployment.',
    );
  }
}

function unavailable(cause: unknown): RecordingStorageError {
  return cause instanceof RecordingStorageError
    ? cause
    : new RecordingStorageError(
      'recording_blob_unavailable',
      'The private attempt recording could not be read from storage.',
      cause,
    );
}

export const vercelRecordingStorage: RecordingStorage = {
  async inspect(reference) {
    assertStorageConfigured();
    try {
      const blob = await head(reference);
      return {
        url: blob.url,
        pathname: blob.pathname,
        contentType: blob.contentType,
        sizeBytes: blob.size,
      };
    } catch (error) {
      throw unavailable(error);
    }
  },

  async read(reference, range) {
    assertStorageConfigured();
    try {
      const headers = new Headers();
      if (range) headers.set('range', range);
      const result = await get(reference, {
        access: 'private',
        headers,
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new RecordingStorageError(
          'recording_blob_unavailable',
          'The private attempt recording is unavailable.',
        );
      }
      const responseHeaders = new Headers();
      result.headers.forEach((value, key) => responseHeaders.set(key, value));
      return {
        url: result.blob.url,
        pathname: result.blob.pathname,
        contentType: result.blob.contentType,
        sizeBytes: result.blob.size,
        stream: result.stream,
        headers: responseHeaders,
      };
    } catch (error) {
      throw unavailable(error);
    }
  },

  async delete(references) {
    if (references.length === 0) return;
    assertStorageConfigured();
    try {
      await del(references);
    } catch (error) {
      throw new RecordingStorageError(
        'recording_storage_unavailable',
        'Private attempt-recording storage could not delete the replay.',
        error,
      );
    }
  },
};
