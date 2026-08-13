export const DEFAULT_VIDEO_MIME_TYPES = Object.freeze([
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.424028,mp4a.40.2',
  'video/mp4',
] as const);

export type RehearsalRecordingState =
  | 'idle'
  | 'recording'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'unsupported'
  | 'disposed';

export type RehearsalRecordingErrorCode =
  | 'media-recorder-unsupported'
  | 'video-track-required'
  | 'invalid-state'
  | 'recording-start-failed'
  | 'recording-failed'
  | 'recording-stop-failed'
  | 'recording-disposed';

export class RehearsalRecordingError extends Error {
  readonly code: RehearsalRecordingErrorCode;

  constructor(
    code: RehearsalRecordingErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RehearsalRecordingError';
    this.code = code;
  }
}

export interface RehearsalRecording {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly chunkCount: number;
  /** Monotonic page-clock values used to align timeline observations. */
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}

/**
 * The small surface used from MediaRecorder keeps the lifecycle independently
 * testable without pretending a Node test runner is a browser.
 */
export interface RecordingMediaRecorder {
  readonly mimeType: string;
  readonly state: RecordingState;
  start(timeslice?: number): void;
  stop(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface RehearsalRecordingEnvironment {
  createRecorder(stream: MediaStream, options?: MediaRecorderOptions): RecordingMediaRecorder;
  isTypeSupported(mimeType: string): boolean;
  now(): number;
}

export interface RehearsalRecordingOptions {
  /** How often MediaRecorder should emit an in-memory chunk. */
  timesliceMs?: number;
  preferredMimeTypes?: readonly string[];
  /** Intended for deterministic tests; normal callers use the browser environment. */
  environment?: RehearsalRecordingEnvironment | null;
  onStateChange?: (state: RehearsalRecordingState) => void;
  onError?: (error: RehearsalRecordingError) => void;
}

export interface RehearsalRecordingSession {
  readonly supported: boolean;
  readonly state: RehearsalRecordingState;
  readonly selectedMimeType: string | null;
  readonly lastRecording: RehearsalRecording | null;
  /** Available during and after a run so other sensors can share its origin. */
  readonly startedAtMs: number | null;
  start(): void;
  stop(): Promise<RehearsalRecording>;
  dispose(): Promise<void>;
}

type DataAvailableEvent = Event & { readonly data?: Blob };
type MediaRecorderFailureEvent = Event & { readonly error?: unknown };

function browserNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function browserEnvironment(): RehearsalRecordingEnvironment | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return {
    createRecorder(stream, options) {
      return new MediaRecorder(stream, options) as unknown as RecordingMediaRecorder;
    },
    isTypeSupported(mimeType) {
      return MediaRecorder.isTypeSupported(mimeType);
    },
    now: browserNow,
  };
}

/**
 * Returns the first supported video type in caller preference order. A null
 * result tells the session to let MediaRecorder choose its browser default.
 */
export function selectSupportedVideoMimeType(
  preferredMimeTypes: readonly string[] = DEFAULT_VIDEO_MIME_TYPES,
  isTypeSupported?: (mimeType: string) => boolean,
): string | null {
  const checker = isTypeSupported ?? (
    typeof MediaRecorder === 'undefined'
      ? null
      : (mimeType: string) => MediaRecorder.isTypeSupported(mimeType)
  );
  if (!checker) return null;

  const checked = new Set<string>();
  for (const preference of preferredMimeTypes) {
    const mimeType = preference.trim();
    if (!mimeType.toLowerCase().startsWith('video/') || checked.has(mimeType)) continue;
    checked.add(mimeType);
    try {
      if (checker(mimeType)) return mimeType;
    } catch {
      // A buggy MIME probe should not prevent trying the next safe candidate.
    }
  }
  return null;
}

function timesliceFrom(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1_000;
  return Math.min(60_000, Math.max(100, Math.round(value)));
}

function eventFailure(event: MediaRecorderFailureEvent): RehearsalRecordingError {
  const cause = event.error;
  const detail = cause instanceof Error && cause.message.trim()
    ? ` ${cause.message.trim()}`
    : '';
  return new RehearsalRecordingError(
    'recording-failed',
    `The browser stopped recording unexpectedly.${detail}`,
    cause,
  );
}

/**
 * Records a supplied camera stream into memory. The stream is borrowed: this
 * session never requests media, uploads bytes, persists bytes, or stops tracks.
 */
export function createRehearsalRecordingSession(
  stream: MediaStream,
  options: RehearsalRecordingOptions = {},
): RehearsalRecordingSession {
  const environment = options.environment === undefined
    ? browserEnvironment()
    : options.environment;
  const supported = environment !== null;
  const selectedMimeType = environment
    ? selectSupportedVideoMimeType(
      options.preferredMimeTypes ?? DEFAULT_VIDEO_MIME_TYPES,
      environment.isTypeSupported,
    )
    : null;
  const timesliceMs = timesliceFrom(options.timesliceMs);

  let currentState: RehearsalRecordingState = supported ? 'idle' : 'unsupported';
  let recorder: RecordingMediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAtMs: number | null = null;
  let stopRequestedAtMs: number | null = null;
  let lastRecording: RehearsalRecording | null = null;
  let lastFailure: RehearsalRecordingError | null = null;
  let stopPromise: Promise<RehearsalRecording> | null = null;
  let resolveStop: ((recording: RehearsalRecording) => void) | null = null;
  let rejectStop: ((error: RehearsalRecordingError) => void) | null = null;
  let disposing = false;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  function setState(next: RehearsalRecordingState) {
    if (currentState === next) return;
    currentState = next;
    options.onStateChange?.(next);
  }

  function report(error: RehearsalRecordingError) {
    lastFailure = error;
    options.onError?.(error);
  }

  function detachRecorderListeners() {
    if (!recorder) return;
    recorder.removeEventListener('dataavailable', handleDataAvailable);
    recorder.removeEventListener('error', handleRecorderError);
    recorder.removeEventListener('stop', handleRecorderStop);
  }

  function clearRun() {
    detachRecorderListeners();
    recorder = null;
    chunks = [];
    startedAtMs = null;
    stopRequestedAtMs = null;
    resolveStop = null;
    rejectStop = null;
    stopPromise = null;
  }

  function rejectPendingStop(error: RehearsalRecordingError) {
    const reject = rejectStop;
    resolveStop = null;
    rejectStop = null;
    reject?.(error);
  }

  function handleDataAvailable(event: Event) {
    const chunk = (event as DataAvailableEvent).data;
    if (chunk && chunk.size > 0) chunks.push(chunk);
  }

  function handleRecorderError(event: Event) {
    if (disposed || lastFailure) return;
    const error = eventFailure(event as MediaRecorderFailureEvent);
    report(error);
    setState('error');
    rejectPendingStop(error);
  }

  function handleRecorderStop() {
    if (!recorder) return;
    const stoppedRecorder = recorder;
    const stoppedAtMs = stopRequestedAtMs ?? environment?.now() ?? browserNow();

    if (lastFailure) {
      const failure = lastFailure;
      detachRecorderListeners();
      recorder = null;
      chunks = [];
      startedAtMs = null;
      stopRequestedAtMs = null;
      rejectPendingStop(failure);
      return;
    }

    const mimeType = stoppedRecorder.mimeType.trim()
      || chunks.find((chunk) => chunk.type.trim())?.type.trim()
      || selectedMimeType
      || '';
    const blob = mimeType ? new Blob(chunks, { type: mimeType }) : new Blob(chunks);
    const recordingStartedAtMs = startedAtMs ?? stoppedAtMs;
    const recording: RehearsalRecording = Object.freeze({
      blob,
      mimeType: blob.type || mimeType,
      sizeBytes: blob.size,
      durationMs: Math.max(0, stoppedAtMs - recordingStartedAtMs),
      chunkCount: chunks.length,
      startedAtMs: recordingStartedAtMs,
      endedAtMs: stoppedAtMs,
    });
    lastRecording = recording;
    const resolve = resolveStop;

    detachRecorderListeners();
    recorder = null;
    chunks = [];
    startedAtMs = null;
    stopRequestedAtMs = null;
    resolveStop = null;
    rejectStop = null;
    stopPromise = null;
    if (!disposing && !disposed) setState('stopped');
    resolve?.(recording);
  }

  function invalidState(message: string): RehearsalRecordingError {
    return new RehearsalRecordingError('invalid-state', message);
  }

  function start() {
    if (disposed || disposing) {
      throw new RehearsalRecordingError(
        'recording-disposed',
        'This rehearsal recorder has already been disposed.',
      );
    }
    if (currentState === 'recording') return;
    if (currentState === 'stopping') {
      throw invalidState('Wait for the current rehearsal recording to finish stopping.');
    }
    if (!environment) {
      const error = new RehearsalRecordingError(
        'media-recorder-unsupported',
        'This browser does not support rehearsal video recording.',
      );
      report(error);
      throw error;
    }
    if (!stream.getVideoTracks().some((track) => track.readyState !== 'ended')) {
      const error = new RehearsalRecordingError(
        'video-track-required',
        'The supplied media stream does not contain a live video track.',
      );
      report(error);
      throw error;
    }

    clearRun();
    lastRecording = null;
    lastFailure = null;
    const recorderOptions = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
    try {
      recorder = environment.createRecorder(stream, recorderOptions);
      recorder.addEventListener('dataavailable', handleDataAvailable);
      recorder.addEventListener('error', handleRecorderError);
      recorder.addEventListener('stop', handleRecorderStop);
      startedAtMs = environment.now();
      recorder.start(timesliceMs);
      setState('recording');
    } catch (cause) {
      const failedRecorder = recorder;
      clearRun();
      if (failedRecorder && failedRecorder.state !== 'inactive') {
        try { failedRecorder.stop(); } catch { /* The native start already failed. */ }
      }
      const error = new RehearsalRecordingError(
        'recording-start-failed',
        'The browser could not start this rehearsal recording.',
        cause,
      );
      report(error);
      setState('error');
      throw error;
    }
  }

  function stop(): Promise<RehearsalRecording> {
    if (lastRecording && currentState === 'stopped') return Promise.resolve(lastRecording);
    if (stopPromise) return stopPromise;
    if (lastFailure && currentState === 'error') return Promise.reject(lastFailure);
    if (disposed) {
      return Promise.reject(new RehearsalRecordingError(
        'recording-disposed',
        'This rehearsal recorder has already been disposed.',
      ));
    }
    if (!recorder || currentState !== 'recording') {
      return Promise.reject(invalidState('Start a rehearsal recording before stopping it.'));
    }

    stopRequestedAtMs = environment?.now() ?? browserNow();
    const pendingStop = new Promise<RehearsalRecording>((resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
    });
    stopPromise = pendingStop;
    setState('stopping');
    try {
      recorder.stop();
    } catch (cause) {
      const error = new RehearsalRecordingError(
        'recording-stop-failed',
        'The browser could not finish this rehearsal recording.',
        cause,
      );
      report(error);
      setState('error');
      rejectPendingStop(error);
      detachRecorderListeners();
      recorder = null;
      chunks = [];
      startedAtMs = null;
      stopRequestedAtMs = null;
    }
    return pendingStop;
  }

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    if (disposed) return Promise.resolve();

    disposing = true;
    disposePromise = (async () => {
      try {
        if (currentState === 'recording' || currentState === 'stopping') {
          try { await stop(); } catch { /* The error was already exposed through onError/stop. */ }
        }
      } finally {
        const activeRecorder = recorder;
        detachRecorderListeners();
        recorder = null;
        chunks = [];
        startedAtMs = null;
        stopRequestedAtMs = null;
        resolveStop = null;
        rejectStop = null;
        stopPromise = null;
        if (activeRecorder && activeRecorder.state !== 'inactive') {
          try { activeRecorder.stop(); } catch { /* Disposal remains idempotent. */ }
        }
        disposed = true;
        disposing = false;
        setState('disposed');
      }
    })();
    return disposePromise;
  }

  return {
    supported,
    get state() { return currentState; },
    selectedMimeType,
    get lastRecording() { return lastRecording; },
    get startedAtMs() { return startedAtMs ?? lastRecording?.startedAtMs ?? null; },
    start,
    stop,
    dispose,
  };
}
