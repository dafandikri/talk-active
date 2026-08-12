import assert from 'node:assert/strict';
import test from 'node:test';

import { estimatePitchHz, rootMeanSquare } from './pitch.ts';

function sineWave(frequencyHz: number, sampleRate: number, length: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => 0.4 * Math.sin(2 * Math.PI * frequencyHz * index / sampleRate),
  );
}

test('rootMeanSquare reports signal energy without retaining the buffer', () => {
  assert.equal(rootMeanSquare(new Float32Array()), 0);
  assert.ok(Math.abs(rootMeanSquare(Float32Array.of(1, -1, 1, -1)) - 1) < 1e-9);
});

test('estimatePitchHz finds a clean voice-range fundamental', () => {
  const estimate = estimatePitchHz(sineWave(220, 48_000, 2_048), 48_000);
  assert.notEqual(estimate, null);
  assert.ok(Math.abs((estimate ?? 0) - 220) < 2, `expected about 220 Hz, received ${estimate}`);
});

test('estimatePitchHz declines to invent pitch for silence or invalid ranges', () => {
  assert.equal(estimatePitchHz(new Float32Array(2_048), 48_000), null);
  assert.equal(estimatePitchHz(sineWave(220, 48_000, 2_048), 0), null);
  assert.equal(estimatePitchHz(sineWave(220, 48_000, 2_048), 48_000, {
    minFrequencyHz: 400,
    maxFrequencyHz: 100,
  }), null);
});
