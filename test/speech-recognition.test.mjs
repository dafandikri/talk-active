import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSpeechRecognitionSession,
} from '../apps/web/lib/rehearsal/speech-recognition.ts';

class FakeSpeechRecognition {
  static latest = null;

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 0;
  onstart = null;
  onresult = null;
  onerror = null;
  onend = null;
  stopFinalTranscript = '';

  constructor() {
    FakeSpeechRecognition.latest = this;
  }

  start() {
    this.onstart?.();
  }

  stop() {
    queueMicrotask(() => {
      if (this.stopFinalTranscript) {
        this.emitResults([{ transcript: this.stopFinalTranscript, isFinal: true }]);
      }
      this.onend?.();
    });
  }

  abort() {
    this.onend?.();
  }

  emitResults(entries) {
    const results = entries.map(({ transcript, isFinal }) => {
      const result = [{ transcript }];
      Object.defineProperty(result, 'isFinal', { value: isFinal });
      return result;
    });
    this.onresult?.({ results });
  }
}

test('stop waits for the final recognition result emitted before onend', async (context) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { SpeechRecognition: FakeSpeechRecognition },
  });
  context.after(() => {
    FakeSpeechRecognition.latest = null;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  const states = [];
  const transcripts = [];
  const session = createSpeechRecognitionSession({
    autoRestart: false,
    onStateChange: (state) => states.push(state),
    onTranscript: (snapshot) => transcripts.push(snapshot),
  });

  assert.equal(session.start(), true);
  const recognition = FakeSpeechRecognition.latest;
  assert.ok(recognition);
  recognition.emitResults([{ transcript: 'kalimat yang belum final', isFinal: false }]);
  recognition.stopFinalTranscript = 'kalimat final saat berhenti';

  const stopResult = await session.stop();

  // observedAtMs is a live clock reading, so it is checked for shape rather than
  // value. It exists because disruption events need a timeline to sit on.
  const { observedAtMs, ...stopTranscript } = stopResult;
  assert.deepEqual(stopTranscript, {
    finalTranscript: 'kalimat final saat berhenti',
    interimTranscript: '',
    transcript: 'kalimat final saat berhenti',
  });
  assert.ok(Number.isFinite(observedAtMs) && observedAtMs >= 0, 'a snapshot must carry a usable timestamp');
  // Each snapshot() reads the clock afresh, so compare the transcript fields
  // from one snapshot rather than two.
  const { observedAtMs: laterObservedAtMs, ...laterTranscript } = session.snapshot();
  assert.deepEqual(laterTranscript, stopTranscript);
  assert.ok(laterObservedAtMs >= observedAtMs, 'the clock must not run backwards between snapshots');
  assert.deepEqual(states, ['starting', 'listening', 'stopping', 'idle']);
  const { observedAtMs: emittedObservedAtMs, ...emittedTranscript } = transcripts.at(-1);
  assert.deepEqual(emittedTranscript, stopTranscript);
  assert.ok(Number.isFinite(emittedObservedAtMs), 'each emitted snapshot carries its own reading');
});

test('the project locale reaches the native recognizer before capture starts', (context) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { SpeechRecognition: FakeSpeechRecognition },
  });
  context.after(() => {
    FakeSpeechRecognition.latest = null;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  const session = createSpeechRecognitionSession({ language: 'en-US', autoRestart: false });
  assert.equal(session.start(), true);
  assert.equal(FakeSpeechRecognition.latest?.lang, 'en-US');
  assert.equal(session.language, 'en-US');
  session.abort();

  session.setLanguage('id-ID');
  assert.equal(session.start(), true);
  assert.equal(FakeSpeechRecognition.latest?.lang, 'id-ID');
  assert.equal(session.language, 'id-ID');
});
