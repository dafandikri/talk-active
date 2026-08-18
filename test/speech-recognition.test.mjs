import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOW_CONFIDENCE_THRESHOLD,
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
    // Chrome reports confidence only on final results, and reports 0 when it
    // has none to give — which is not the same as "certainly wrong".
    const results = entries.map(({ transcript, isFinal, confidence = 0.95 }) => {
      const result = [{ transcript, confidence }];
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
    // The snapshot gained lowConfidenceRanges. A confident run reports none,
    // which is the property worth pinning here rather than the field merely
    // existing.
    lowConfidenceRanges: [],
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

// The recognizer already reports how sure it is, per final result, and every
// one of those numbers was thrown away. A span it guessed at looks exactly
// like a span it heard clearly, and INV-3 then quotes it back to the student
// as their own words — fabricated evidence with their name on it.

function withFakeRecognition(context) {
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
}

test('a confident run marks nothing', async (context) => {
  withFakeRecognition(context);
  const session = createSpeechRecognitionSession({ autoRestart: false });
  session.start();
  FakeSpeechRecognition.latest.emitResults([
    { transcript: 'Kami menguji prototipe ini', isFinal: true, confidence: 0.94 },
  ]);
  assert.deepEqual(session.snapshot().lowConfidenceRanges, []);
});

test('a guessed span is marked with the exact characters it covers', async (context) => {
  withFakeRecognition(context);
  const session = createSpeechRecognitionSession({ autoRestart: false });
  session.start();
  FakeSpeechRecognition.latest.emitResults([
    { transcript: 'Kami menguji prototipe', isFinal: true, confidence: 0.95 },
    { transcript: 'bersama dua belas mahasiswa', isFinal: true, confidence: 0.21 },
  ]);

  const snapshot = session.snapshot();
  assert.equal(snapshot.lowConfidenceRanges.length, 1);
  const [range] = snapshot.lowConfidenceRanges;
  // The range has to index the transcript the analyzer will actually receive,
  // not the fragment the recognizer emitted.
  assert.equal(
    snapshot.finalTranscript.slice(range.startChar, range.endChar),
    'bersama dua belas mahasiswa',
  );
  assert.ok(range.confidence < LOW_CONFIDENCE_THRESHOLD);
});

test('confidence of zero means unreported, not certainly wrong', async (context) => {
  // A browser that supplies no confidence at all must not have its entire
  // transcript marked as a guess. That would train users to ignore the marks.
  withFakeRecognition(context);
  const session = createSpeechRecognitionSession({ autoRestart: false });
  session.start();
  FakeSpeechRecognition.latest.emitResults([
    { transcript: 'Sebuah kalimat penuh', isFinal: true, confidence: 0 },
    { transcript: 'dan satu lagi', isFinal: true, confidence: 0 },
  ]);
  assert.deepEqual(session.snapshot().lowConfidenceRanges, []);
});

test('interim results are never marked, however unsure they look', async (context) => {
  // Chrome reports ~0 confidence for interim results as a matter of course.
  // Marking them would flicker warnings over text that is still being revised.
  withFakeRecognition(context);
  const session = createSpeechRecognitionSession({ autoRestart: false });
  session.start();
  FakeSpeechRecognition.latest.emitResults([
    { transcript: 'masih diucapkan', isFinal: false, confidence: 0.02 },
  ]);
  assert.deepEqual(session.snapshot().lowConfidenceRanges, []);
});

test('ranges survive the restart that settles one run into the transcript', async (context) => {
  withFakeRecognition(context);
  const session = createSpeechRecognitionSession({ autoRestart: false });
  session.start();
  FakeSpeechRecognition.latest.emitResults([
    { transcript: 'bagian pertama', isFinal: true, confidence: 0.3 },
  ]);
  FakeSpeechRecognition.latest.onend?.();
  session.start({ resetTranscript: false });
  FakeSpeechRecognition.latest.emitResults([
    { transcript: 'bagian kedua', isFinal: true, confidence: 0.92 },
  ]);

  const snapshot = session.snapshot();
  assert.equal(snapshot.lowConfidenceRanges.length, 1);
  const [range] = snapshot.lowConfidenceRanges;
  assert.equal(
    snapshot.finalTranscript.slice(range.startChar, range.endChar),
    'bagian pertama',
  );
});
