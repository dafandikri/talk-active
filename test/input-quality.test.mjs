import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MINIMUM_QUALITY_SAMPLES,
  assessInputQuality,
} from '../apps/web/lib/rehearsal/input-quality.ts';

// Level samples, not audio. Each entry is one RMS reading from the observer.
function samples(values) {
  return values.map((rms) => ({ rms }));
}

function repeated(value, count) {
  return Array.from({ length: count }, () => value);
}

/** Speech: quiet gaps between phrases, peaks well short of full scale. */
function speechPattern() {
  return samples([
    ...repeated(0.002, 6),
    ...repeated(0.18, 10),
    ...repeated(0.003, 5),
    ...repeated(0.22, 10),
    ...repeated(0.002, 5),
  ]);
}

test('a normal speech pattern is usable', () => {
  const verdict = assessInputQuality(speechPattern());
  assert.equal(verdict.code, 'usable');
  assert.equal(verdict.actionable, false);
});

test('too few samples is reported as insufficient rather than guessed at', () => {
  const verdict = assessInputQuality(samples(repeated(0.2, MINIMUM_QUALITY_SAMPLES - 1)));
  assert.equal(verdict.code, 'insufficient');
  // Not actionable: telling someone their mic is bad because we listened for
  // a tenth of a second would be worse than saying nothing.
  assert.equal(verdict.actionable, false);
});

test('a mic delivering nothing is silent, not merely quiet', () => {
  const verdict = assessInputQuality(samples(repeated(0.0001, 40)));
  assert.equal(verdict.code, 'silent');
  assert.equal(verdict.actionable, true);
});

test('a hot mic that pins near full scale is reported as clipping', () => {
  const verdict = assessInputQuality(samples([
    ...repeated(0.9, 20),
    ...repeated(0.85, 20),
  ]));
  assert.equal(verdict.code, 'clipping');
  assert.equal(verdict.actionable, true);
});

// This is the vibrating handheld. Speech peaks look fine, but the mic never
// goes quiet between phrases because it is picking up handling noise and
// rumble, so the recognizer has no silence to segment on.
test('a mic whose floor never drops is reported as a noisy floor', () => {
  const verdict = assessInputQuality(samples([
    ...repeated(0.09, 8),
    ...repeated(0.24, 10),
    ...repeated(0.11, 8),
    ...repeated(0.26, 10),
    ...repeated(0.10, 8),
  ]));
  assert.equal(verdict.code, 'noisy-floor');
  assert.equal(verdict.actionable, true);
});

test('audible but very faint speech is too quiet, distinct from silent', () => {
  const verdict = assessInputQuality(samples([
    ...repeated(0.0008, 10),
    ...repeated(0.012, 12),
    ...repeated(0.0009, 10),
    ...repeated(0.014, 12),
  ]));
  assert.equal(verdict.code, 'too-quiet');
  assert.equal(verdict.actionable, true);
});

test('clipping outranks a noisy floor, because it is the more specific fault', () => {
  // A clipping mic also has a high floor. Reporting the floor would send the
  // user to fix the wrong thing.
  const verdict = assessInputQuality(samples(repeated(0.95, 40)));
  assert.equal(verdict.code, 'clipping');
});

test('the verdict carries the numbers behind it, so the message can be specific', () => {
  const verdict = assessInputQuality(speechPattern());
  assert.equal(typeof verdict.values.peak, 'number');
  assert.equal(typeof verdict.values.floor, 'number');
  assert.ok(verdict.values.peak > verdict.values.floor);
});
