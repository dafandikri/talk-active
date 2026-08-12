import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RehearsalRecordingError,
  createRehearsalRecordingSession,
  selectSupportedVideoMimeType,
  type RecordingMediaRecorder,
  type RehearsalRecordingEnvironment,
} from './recording.ts';

class FakeRecorder implements RecordingMediaRecorder {
  readonly events = new EventTarget();
  readonly sourceStream: MediaStream;
  readonly recorderOptions: MediaRecorderOptions | undefined;
  mimeType: string;
  state: RecordingState = 'inactive';
  startCalls = 0;
  stopCalls = 0;
  timesliceMs: number | undefined;
  startFailure: unknown = null;
  stopFailure: unknown = null;
  emitStopAutomatically = false;

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.sourceStream = stream;
    this.recorderOptions = options;
    this.mimeType = options?.mimeType ?? 'video/browser-default';
  }

  addEventListener(type: string, listener: EventListener): void {
    this.events.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.events.removeEventListener(type, listener);
  }

  start(timeslice?: number): void {
    this.startCalls += 1;
    this.timesliceMs = timeslice;
    if (this.startFailure) throw this.startFailure;
    this.state = 'recording';
  }

  stop(): void {
    this.stopCalls += 1;
    if (this.stopFailure) throw this.stopFailure;
    this.state = 'inactive';
    if (this.emitStopAutomatically) queueMicrotask(() => this.emitStop());
  }

  emitChunk(contents: string, mimeType = this.mimeType): void {
    const event = Object.assign(new Event('dataavailable'), {
      data: new Blob([contents], { type: mimeType }),
    });
    this.events.dispatchEvent(event);
  }

  emitError(error: Error): void {
    this.events.dispatchEvent(Object.assign(new Event('error'), { error }));
  }

  emitStop(): void {
    this.events.dispatchEvent(new Event('stop'));
  }
}

function borrowedStream(videoTrackCount = 1) {
  let stopCalls = 0;
  const tracks = Array.from({ length: videoTrackCount }, () => ({
    readyState: 'live',
    stop() { stopCalls += 1; },
  })) as unknown as MediaStreamTrack[];
  const stream = {
    getVideoTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
  return { stream, tracks, get stopCalls() { return stopCalls; } };
}

function recorderHarness({
  supportedTypes = ['video/webm;codecs=vp8,opus'],
  now = 0,
}: {
  supportedTypes?: readonly string[];
  now?: number;
} = {}) {
  const recorders: FakeRecorder[] = [];
  let currentTime = now;
  const environment: RehearsalRecordingEnvironment = {
    createRecorder(stream, options) {
      const recorder = new FakeRecorder(stream, options);
      recorders.push(recorder);
      return recorder;
    },
    isTypeSupported: (mimeType) => supportedTypes.includes(mimeType),
    now: () => currentTime,
  };
  return {
    environment,
    recorders,
    setNow(value: number) { currentTime = value; },
  };
}

test('MIME selection follows preference order and ignores unsafe or broken probes', () => {
  const probes: string[] = [];
  const selected = selectSupportedVideoMimeType([
    ' audio/webm ',
    'video/broken',
    ' video/mp4 ',
    'video/mp4',
  ], (mimeType) => {
    probes.push(mimeType);
    if (mimeType === 'video/broken') throw new Error('bad browser probe');
    return mimeType === 'video/mp4';
  });

  assert.equal(selected, 'video/mp4');
  assert.deepEqual(probes, ['video/broken', 'video/mp4']);
});

test('records chunks from the supplied stream and returns inspectable Blob metadata', async () => {
  const borrowed = borrowedStream();
  const harness = recorderHarness({ now: 100 });
  const states: string[] = [];
  const session = createRehearsalRecordingSession(borrowed.stream, {
    environment: harness.environment,
    timesliceMs: 250,
    onStateChange: (state) => states.push(state),
  });

  assert.equal(session.supported, true);
  assert.equal(session.selectedMimeType, 'video/webm;codecs=vp8,opus');
  session.start();
  session.start();

  const recorder = harness.recorders[0];
  assert.ok(recorder);
  assert.equal(harness.recorders.length, 1);
  assert.equal(recorder.sourceStream, borrowed.stream);
  assert.deepEqual(recorder.recorderOptions, { mimeType: session.selectedMimeType });
  assert.equal(recorder.startCalls, 1);
  assert.equal(recorder.timesliceMs, 250);
  assert.equal(session.startedAtMs, 100);
  recorder.emitChunk('first-');
  recorder.emitChunk('second');

  harness.setNow(1_600);
  const firstStop = session.stop();
  const repeatedStop = session.stop();
  assert.equal(firstStop, repeatedStop);
  assert.equal(recorder.stopCalls, 1);
  recorder.emitStop();

  const recording = await firstStop;
  assert.equal(await recording.blob.text(), 'first-second');
  assert.equal(recording.mimeType, 'video/webm;codecs=vp8,opus');
  assert.equal(recording.sizeBytes, 12);
  assert.equal(recording.durationMs, 1_500);
  assert.equal(recording.chunkCount, 2);
  assert.equal(recording.startedAtMs, 100);
  assert.equal(recording.endedAtMs, 1_600);
  assert.equal(session.startedAtMs, 100);
  assert.equal(session.lastRecording, recording);
  assert.equal(await session.stop(), recording);
  assert.equal(borrowed.stopCalls, 0);
  assert.deepEqual(states, ['recording', 'stopping', 'stopped']);
});

test('falls back to the browser MIME while still requesting chunked recording', async () => {
  const borrowed = borrowedStream();
  const harness = recorderHarness({ supportedTypes: [] });
  const session = createRehearsalRecordingSession(borrowed.stream, {
    environment: harness.environment,
    preferredMimeTypes: ['video/unknown'],
    timesliceMs: 1,
  });

  assert.equal(session.selectedMimeType, null);
  session.start();
  const recorder = harness.recorders[0];
  assert.ok(recorder);
  assert.equal(recorder.recorderOptions, undefined);
  assert.equal(recorder.timesliceMs, 100);
  recorder.mimeType = 'video/mp4';
  recorder.emitChunk('video', 'video/mp4');
  const stopped = session.stop();
  recorder.emitStop();
  const recording = await stopped;
  assert.equal(recording.mimeType, 'video/mp4');
  assert.equal(recording.sizeBytes, 5);
});

test('reports unsupported browsers and missing video without touching tracks', () => {
  const borrowed = borrowedStream();
  const unsupported = createRehearsalRecordingSession(borrowed.stream, { environment: null });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.state, 'unsupported');
  assert.throws(
    () => unsupported.start(),
    (error) => error instanceof RehearsalRecordingError
      && error.code === 'media-recorder-unsupported',
  );

  const noVideo = borrowedStream(0);
  const harness = recorderHarness();
  const missingTrack = createRehearsalRecordingSession(noVideo.stream, {
    environment: harness.environment,
  });
  assert.throws(
    () => missingTrack.start(),
    (error) => error instanceof RehearsalRecordingError
      && error.code === 'video-track-required',
  );
  assert.equal(harness.recorders.length, 0);
  assert.equal(borrowed.stopCalls, 0);
  assert.equal(noVideo.stopCalls, 0);
});

test('converts native start and recording failures into stable typed errors', async () => {
  const borrowed = borrowedStream();
  const harness = recorderHarness();
  const observed: RehearsalRecordingError[] = [];
  const session = createRehearsalRecordingSession(borrowed.stream, {
    environment: harness.environment,
    onError: (error) => observed.push(error),
  });

  harness.environment.createRecorder = (stream, options) => {
    const recorder = new FakeRecorder(stream, options);
    recorder.startFailure = new DOMException('encoder unavailable', 'NotReadableError');
    harness.recorders.push(recorder);
    return recorder;
  };
  assert.throws(
    () => session.start(),
    (error) => error instanceof RehearsalRecordingError
      && error.code === 'recording-start-failed'
      && error.cause instanceof DOMException,
  );

  harness.environment.createRecorder = (stream, options) => {
    const recorder = new FakeRecorder(stream, options);
    harness.recorders.push(recorder);
    return recorder;
  };
  session.start();
  const recorder = harness.recorders.at(-1);
  assert.ok(recorder);
  const stopping = session.stop();
  recorder.emitError(new Error('encoder crashed'));
  await assert.rejects(
    stopping,
    (error) => error instanceof RehearsalRecordingError
      && error.code === 'recording-failed'
      && /encoder crashed/u.test(error.message),
  );
  recorder.emitStop();
  assert.equal(session.state, 'error');
  assert.deepEqual(observed.map((error) => error.code), [
    'recording-start-failed',
    'recording-failed',
  ]);
  assert.equal(borrowed.stopCalls, 0);
});

test('dispose is idempotent, finalizes an active recorder, and leaves shared tracks live', async () => {
  const borrowed = borrowedStream();
  const harness = recorderHarness();
  const session = createRehearsalRecordingSession(borrowed.stream, {
    environment: harness.environment,
  });
  session.start();
  const recorder = harness.recorders[0];
  assert.ok(recorder);
  recorder.emitStopAutomatically = true;
  recorder.emitChunk('kept in memory');

  const firstDispose = session.dispose();
  const repeatedDispose = session.dispose();
  assert.equal(firstDispose, repeatedDispose);
  await firstDispose;

  assert.equal(recorder.stopCalls, 1);
  assert.equal(session.state, 'disposed');
  assert.equal(await session.lastRecording?.blob.text(), 'kept in memory');
  assert.equal(borrowed.stopCalls, 0);
  await session.dispose();
  assert.throws(
    () => session.start(),
    (error) => error instanceof RehearsalRecordingError
      && error.code === 'recording-disposed',
  );
});
