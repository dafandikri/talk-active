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

  assert.deepEqual(stopResult, {
    finalTranscript: 'kalimat final saat berhenti',
    interimTranscript: '',
    transcript: 'kalimat final saat berhenti',
  });
  assert.deepEqual(session.snapshot(), stopResult);
  assert.deepEqual(states, ['starting', 'listening', 'stopping', 'idle']);
  assert.deepEqual(transcripts.at(-1), stopResult);
});
