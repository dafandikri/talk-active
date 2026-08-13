import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InterimFillerTracker,
  SpeechDisruptionDetector,
  mergeSpeechDisruptionEvents,
} from './speech-disruptions.ts';

function sample(timestampMs: number, voiced: boolean, pitchHz = 180, rms = 0.08) {
  return { timestampMs, quiet: !voiced, pitchHz: voiced ? pitchHz : null, rms: voiced ? rms : 0.001 };
}

test('stable prolonged voicing produces one timestamped possible hesitation', () => {
  const detector = new SpeechDisruptionDetector();
  for (let timestampMs = 0; timestampMs <= 800; timestampMs += 100) {
    detector.addSample(sample(timestampMs, true, 180 + (timestampMs % 200 === 0 ? 2 : -2)));
  }
  const emitted = detector.addSample(sample(900, false));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.kind, 'prolonged-voicing');
  assert.equal(emitted[0]?.startMs, 0);
  assert.equal(emitted[0]?.endMs, 900);
});

test('ordinary short voiced regions do not become a prolonged event', () => {
  const detector = new SpeechDisruptionDetector();
  for (let timestampMs = 0; timestampMs <= 400; timestampMs += 100) {
    detector.addSample(sample(timestampMs, true));
  }
  detector.addSample(sample(500, false));
  assert.deepEqual(detector.events(), []);
});

test('a roughly six-tenths-second stable filler can produce a cue', () => {
  const detector = new SpeechDisruptionDetector();
  for (let timestampMs = 0; timestampMs <= 500; timestampMs += 100) {
    detector.addSample(sample(timestampMs, true));
  }
  const emitted = detector.addSample(sample(600, false));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.kind, 'prolonged-voicing');
});

test('large timestamp gaps flush state instead of inventing continuous voicing', () => {
  const detector = new SpeechDisruptionDetector();
  for (const timestampMs of [0, 100, 200, 300, 1_000, 1_100, 1_200, 1_300]) {
    detector.addSample(sample(timestampMs, true));
  }
  detector.finish(1_400);
  assert.deepEqual(detector.events(), []);
});

test('finishing after a delayed callback does not stretch a short sound into an event', () => {
  const detector = new SpeechDisruptionDetector();
  for (const timestampMs of [0, 100, 200]) detector.addSample(sample(timestampMs, true));
  detector.finish(5_000);
  assert.deepEqual(detector.events(), []);
});

test('finish is idempotent and reset makes the detector reusable', () => {
  const detector = new SpeechDisruptionDetector();
  for (let timestampMs = 0; timestampMs <= 700; timestampMs += 100) {
    detector.addSample(sample(timestampMs, true));
  }
  assert.equal(detector.finish(800).length, 1);
  assert.deepEqual(detector.finish(900), []);

  detector.reset();
  for (let timestampMs = 0; timestampMs <= 700; timestampMs += 100) {
    detector.addSample(sample(timestampMs, true));
  }
  assert.equal(detector.finish(800).length, 1);
  assert.equal(detector.events().length, 1);
});

test('configured calibration pre-roll never emits a hesitation cue', () => {
  const detector = new SpeechDisruptionDetector({ ignoreBeforeMs: 3_000 });
  for (let timestampMs = 0; timestampMs <= 2_900; timestampMs += 100) {
    detector.addSample(sample(timestampMs, true));
  }
  detector.addSample(sample(3_000, false));
  assert.deepEqual(detector.events(), []);
});

test('a wide pitch sweep is not labelled as a stable prolonged vocalization', () => {
  const detector = new SpeechDisruptionDetector();
  for (let timestampMs = 0; timestampMs <= 800; timestampMs += 100) {
    detector.addSample(sample(timestampMs, true, 120 + timestampMs * 0.15));
  }
  detector.addSample(sample(900, false));
  assert.deepEqual(detector.events(), []);
});

test('three similar voiced bursts separated by micro-gaps produce one repeated-start cue', () => {
  const detector = new SpeechDisruptionDetector();
  for (const timestampMs of [0, 100, 300, 400, 600, 700]) {
    detector.addSample(sample(timestampMs, true, 190, 0.07));
    if (timestampMs % 300 === 100) detector.addSample(sample(timestampMs + 100, false));
  }
  detector.addSample(sample(800, false));
  const events = detector.events();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'repeated-start');
});

test('one ordinary pause between two phrases is not a repeated-start cue', () => {
  const detector = new SpeechDisruptionDetector();
  for (const timestampMs of [0, 100, 300, 400]) {
    detector.addSample(sample(timestampMs, true));
    if (timestampMs === 100) detector.addSample(sample(200, false));
  }
  detector.addSample(sample(500, false));
  assert.deepEqual(detector.events(), []);
});

test('interim filler tracker retains cleaned hypotheses without double-counting updates', () => {
  const tracker = new InterimFillerTracker();
  assert.equal(tracker.addInterimTranscript('eeh', 1_000).length, 1);
  assert.equal(tracker.addInterimTranscript('eeh our', 1_150).length, 0);
  assert.equal(tracker.addInterimTranscript('', 1_500).length, 0);
  assert.equal(tracker.addInterimTranscript('umm next', 2_000).length, 1);
  assert.deepEqual(tracker.events().map((event) => event.label), [
    'Possible filler “eh”',
    'Possible filler “um”',
  ]);
});

test('an empty recognition boundary allows the same filler in the next utterance', () => {
  const tracker = new InterimFillerTracker();
  assert.equal(tracker.addInterimTranscript('umm', 1_000).length, 1);
  assert.equal(tracker.addInterimTranscript('', 1_300).length, 0);
  assert.equal(tracker.addInterimTranscript('umm next', 2_000).length, 1);
  assert.equal(tracker.events().length, 2);
});

test('a new interview utterance resets its hypothesis without erasing earlier cues', () => {
  const tracker = new InterimFillerTracker();
  assert.equal(tracker.addInterimTranscript('umm first answer', 1_000).length, 1);
  tracker.beginUtterance();
  assert.equal(tracker.addInterimTranscript('umm second answer', 4_000).length, 1);
  assert.deepEqual(tracker.events().map((event) => event.startMs), [1_000, 4_000]);
});

test('overlapping interim and acoustic cues merge into one inspectable event', () => {
  const merged = mergeSpeechDisruptionEvents(
    [{ kind: 'prolonged-voicing', source: 'acoustic', startMs: 1_000, endMs: 1_900, durationMs: 900, label: 'Possible prolonged voiced hesitation', evidence: 'acoustic' }],
    [{ kind: 'interim-filler', source: 'interim-transcript', startMs: 1_500, endMs: 1_500, durationMs: 0, label: 'Possible filler “um”', evidence: 'interim' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.source, 'combined');
  assert.match(merged[0]?.label ?? '', /filler “um”/u);
});

test('an acoustic cue merges with the nearest eligible interim cue', () => {
  const merged = mergeSpeechDisruptionEvents(
    [
      { kind: 'interim-filler', source: 'interim-transcript', startMs: 0, endMs: 0, durationMs: 0, label: 'Early filler', evidence: 'early' },
      { kind: 'interim-filler', source: 'interim-transcript', startMs: 600, endMs: 600, durationMs: 0, label: 'Nearest filler', evidence: 'nearest' },
    ],
    [{ kind: 'prolonged-voicing', source: 'acoustic', startMs: 650, endMs: 900, durationMs: 250, label: 'Acoustic cue', evidence: 'acoustic' }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.source, 'interim-transcript');
  assert.equal(merged[1]?.source, 'combined');
  assert.equal(merged[1]?.startMs, 600);
});
