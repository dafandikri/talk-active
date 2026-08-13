// ============================================================================
//  The rehearsal figure must describe its own arithmetic.
//
//  INV-6 permits a summary number over one attempt only when it names the
//  weighting it actually used. The screen previously printed a fixed
//  "50 / 25 / 25" sentence while the code renormalized around missing signals,
//  so a camera-less attempt showed a caption that was simply untrue about the
//  number printed beside it. These tests pin the caption to the arithmetic.
// ============================================================================
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeRehearsalReading } from '../apps/web/lib/rehearsal-reading.ts';

function weightOf(reading, id) {
  const found = reading.components.find((component) => component.id === id);
  assert.ok(found, `missing component ${id}`);
  return found.weight;
}

test('a fully measured attempt splits 50 / 25 / 25 and says so', () => {
  const reading = summarizeRehearsalReading({ substance: 80, vocal: 60, visual: 40 });

  assert.equal(weightOf(reading, 'substance'), 0.5);
  assert.equal(weightOf(reading, 'vocal'), 0.25);
  assert.equal(weightOf(reading, 'visual'), 0.25);
  assert.equal(reading.total, Math.round(80 * 0.5 + 60 * 0.25 + 40 * 0.25));
  assert.equal(reading.weighting, '50% rubric substance · 25% vocal signals · 25% visual signals');
  assert.deepEqual(reading.unmeasured, []);
});

test('an excluded camera moves its weight to the vocal reading and renames the split', () => {
  // This is the case the old fixed caption got wrong: the vocal reading is
  // carrying half the figure, not a quarter.
  const reading = summarizeRehearsalReading({ substance: 80, vocal: 60, visual: null });

  assert.equal(weightOf(reading, 'substance'), 0.5);
  assert.equal(weightOf(reading, 'vocal'), 0.5);
  assert.equal(weightOf(reading, 'visual'), 0);
  assert.equal(reading.total, 70);
  assert.equal(reading.weighting, '50% rubric substance · 50% vocal signals');
  assert.match(reading.weighting, /50% vocal/u, 'the caption must not still claim 25%');
});

test('with no delivery signal at all the figure is the substance reading alone', () => {
  const reading = summarizeRehearsalReading({ substance: 73, vocal: null, visual: null });

  assert.equal(reading.total, 73);
  assert.equal(weightOf(reading, 'substance'), 1);
  assert.equal(reading.weighting, '100% rubric substance');
  assert.equal(reading.unmeasured.length, 2, 'both missing signals must be named');
});

test('every excluded signal is named beside the number, never left blank', () => {
  const reading = summarizeRehearsalReading({
    substance: 50,
    vocal: 70,
    visual: null,
    visualExcludedReason: 'Tracking held for only 41% of sampled frames.',
  });

  assert.deepEqual(reading.unmeasured, [
    'visual signals: Tracking held for only 41% of sampled frames.',
  ]);
  const visual = reading.components.find((component) => component.id === 'visual');
  assert.equal(visual.score, null);
  assert.match(visual.excluded, /41%/u, 'the supplied reason must reach the screen verbatim');
});

test('an unmeasured signal is excluded from the mean, never counted as zero', () => {
  // Counting a missing camera as 0 would turn "we could not see you" into
  // "you did badly" — the exact overclaim INV-2 forbids.
  const measured = summarizeRehearsalReading({ substance: 90, vocal: 90, visual: null });
  const zeroed = summarizeRehearsalReading({ substance: 90, vocal: 90, visual: 0 });

  assert.equal(measured.total, 90);
  assert.equal(zeroed.total, 68);
  assert.ok(measured.total > zeroed.total, 'excluding must not be penalised like a zero');
});

test('the stated weighting always sums to the whole figure', () => {
  const cases = [
    { substance: 80, vocal: 60, visual: 40 },
    { substance: 80, vocal: 60, visual: null },
    { substance: 80, vocal: null, visual: 40 },
    { substance: 80, vocal: null, visual: null },
  ];

  for (const input of cases) {
    const reading = summarizeRehearsalReading(input);
    const applied = reading.components.reduce((sum, component) => sum + component.weight, 0);
    assert.equal(
      Math.round(applied * 1000) / 1000,
      1,
      `applied weights must total 1 for ${JSON.stringify(input)}`,
    );
    const stated = [...reading.weighting.matchAll(/(\d+)%/gu)]
      .reduce((sum, match) => sum + Number(match[1]), 0);
    assert.equal(stated, 100, `the printed caption must total 100% for ${JSON.stringify(input)}`);
  }
});

test('the nominal weighting stays visible so the exclusion is legible as a change', () => {
  const reading = summarizeRehearsalReading({ substance: 80, vocal: 60, visual: null });
  const vocal = reading.components.find((component) => component.id === 'vocal');

  assert.equal(vocal.nominalWeight, 0.25);
  assert.equal(vocal.weight, 0.5);
  assert.notEqual(vocal.weight, vocal.nominalWeight);
});
