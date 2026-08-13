import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TranscriptTimingTracker,
  estimateRangeTiming,
} from '../apps/web/lib/rehearsal/transcript-timing.ts';

test('T-1 the tracker keeps only growth, so interim rewrites cannot read backwards', () => {
  const tracker = new TranscriptTimingTracker();
  tracker.addSnapshot('halo semua', 1_000);
  tracker.addSnapshot('halo semu', 1_400);
  tracker.addSnapshot('halo semua nama saya', 2_000);
  tracker.addSnapshot('halo semua nama saya sultan', 1_800);
  tracker.addSnapshot('', 3_000);

  assert.deepEqual(tracker.points(), [
    { charCount: 10, atMs: 1_000 },
    { charCount: 20, atMs: 2_000 },
  ]);
});

test('T-1 an offset between two snapshots is interpolated', () => {
  const points = [
    { charCount: 10, atMs: 1_000 },
    { charCount: 30, atMs: 3_000 },
  ];
  assert.deepEqual(estimateRangeTiming(points, 20, 30), { startMs: 2_000, endMs: 3_000 });
});

test('T-1 offsets outside the observed transcript clamp to its ends', () => {
  const points = [{ charCount: 10, atMs: 1_000 }];
  assert.deepEqual(estimateRangeTiming(points, 0, 5), { startMs: 0, endMs: 500 });
  assert.deepEqual(estimateRangeTiming(points, 50, 90), { startMs: 1_000, endMs: 1_000 });
});

test('T-1 a typed transcript is refused rather than given an invented time', () => {
  assert.equal(estimateRangeTiming([], 0, 10), null);
  assert.equal(estimateRangeTiming([{ charCount: 10, atMs: 1_000 }], Number.NaN, 4), null);
});

test('T-1 reversed offsets still return an ordered range', () => {
  const points = [
    { charCount: 10, atMs: 1_000 },
    { charCount: 20, atMs: 2_000 },
  ];
  const timing = estimateRangeTiming(points, 20, 10);
  assert.deepEqual(timing, { startMs: 1_000, endMs: 2_000 });
  assert.ok(timing.endMs >= timing.startMs);
});
