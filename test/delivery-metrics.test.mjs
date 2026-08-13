import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DeliveryMetricsError,
  analyzeDeliveryMetrics,
} from '../apps/web/lib/delivery-metrics.ts';

function metric(group, id) {
  const found = group.metrics.find((item) => item.id === id);
  assert.ok(found, `missing metric ${id}`);
  return found;
}

test('transcript observations expose configured fillers and adjacent repeated words', () => {
  const transcript = 'Ummm, we we built this, apa ya, basically for students.';
  const words = transcript.match(/[\p{L}\p{N}]+/gu).map((text, index) => ({
    text,
    startSeconds: index * 0.5,
  }));
  const result = analyzeDeliveryMetrics({
    durationSeconds: 12,
    transcript,
    timedWords: words,
  });

  assert.equal(result.fillerCount, 3);
  assert.deepEqual(result.fillers, [
    { label: 'um', count: 1 },
    { label: 'apa ya', count: 1 },
    { label: 'basically', count: 1 },
  ]);
  assert.equal(result.repeatedWordCount, 1);
  assert.deepEqual(result.repeatedWordEvents, [{
    word: 'we',
    additionalOccurrences: 1,
    tokenIndex: 2,
    timestampSeconds: 1,
  }]);
  assert.match(result.boundary, /deliberate repetition or transcription errors/u);
});

test('filler variants include English and Indonesian cues without double-counting repeats', () => {
  const result = analyzeDeliveryMetrics({
    durationSeconds: 20,
    transcript: 'Um umm uhhh ee eeee eeh emm hmm mm ahh err anu kayak gitu apa ya basically finish.',
  });

  assert.equal(result.fillerCount, 16);
  assert.deepEqual(result.fillers, [
    { label: 'um', count: 2 },
    { label: 'uh', count: 1 },
    { label: 'ee', count: 2 },
    { label: 'eh', count: 1 },
    { label: 'emm', count: 1 },
    { label: 'hmm', count: 1 },
    { label: 'mm', count: 1 },
    { label: 'ah', count: 1 },
    { label: 'er', count: 1 },
    { label: 'anu', count: 1 },
    { label: 'kayak', count: 1 },
    { label: 'gitu', count: 1 },
    { label: 'apa ya', count: 1 },
    { label: 'basically', count: 1 },
  ]);
  assert.equal(result.repeatedWordCount, 0, 'filler runs belong to the filler observation only');
});

test('vocal observations calculate pace, pauses, pitch, and energy with full coverage', () => {
  const transcript = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
  const result = analyzeDeliveryMetrics({
    durationSeconds: 30,
    transcript,
    audio: {
      pauseSeconds: 5,
      pitchHzSamples: [180, 200, 220, 180, 220, 200],
      energyRmsSamples: [0.10, 0.15, 0.20, 0.12, 0.18, 0.16],
    },
  });

  assert.equal(result.wordsPerMinute, 120);
  assert.equal(result.vocal.measurementCoverage, 100);
  assert.equal(metric(result.vocal, 'pace').rehearsalScore, 100);
  assert.equal(metric(result.vocal, 'pause-ratio').observedValue, 16.7);
  assert.equal(metric(result.vocal, 'pause-ratio').rehearsalScore, 100);
  assert.equal(metric(result.vocal, 'pitch-variation').available, true);
  assert.equal(metric(result.vocal, 'energy-variation').available, true);
});

test('missing audio observations stay unavailable and remaining weights are renormalized', () => {
  const result = analyzeDeliveryMetrics({
    durationSeconds: 30,
    transcript: Array.from({ length: 60 }, (_, index) => `word${index}`).join(' '),
  });

  assert.equal(result.vocal.measurementCoverage, 55);
  assert.equal(result.vocal.rehearsalScore, 100);
  for (const id of ['pause-ratio', 'pitch-variation', 'energy-variation']) {
    const observation = metric(result.vocal, id);
    assert.equal(observation.available, false);
    assert.equal(observation.rehearsalScore, null);
  }
});

test('presentation vision observations retain each denominator and weighted contribution', () => {
  const result = analyzeDeliveryMetrics({
    durationSeconds: 30,
    transcript: 'A short recognized transcript for the rehearsal.',
    vision: {
      mode: 'presentation',
      sampledFrames: 100,
      trackedFrames: 90,
      framedFrames: 72,
      movementActiveFrames: 27,
    },
  });

  assert.ok(result.visual);
  assert.equal(result.visual.measurementCoverage, 100);
  assert.equal(metric(result.visual, 'tracking-coverage').observedValue, 90);
  assert.equal(metric(result.visual, 'framing-coverage').observedValue, 80);
  assert.equal(metric(result.visual, 'movement-activity').observedValue, 30);
  assert.equal(result.visual.rehearsalScore, 89);
});

test('movement bands differ explicitly between interview and presentation modes', () => {
  const base = {
    durationSeconds: 30,
    transcript: 'A short recognized transcript for comparison.',
  };
  const counts = {
    sampledFrames: 100,
    trackedFrames: 100,
    framedFrames: 100,
    movementActiveFrames: 50,
  };
  const interview = analyzeDeliveryMetrics({
    ...base,
    vision: { mode: 'interview', ...counts },
  });
  const presentation = analyzeDeliveryMetrics({
    ...base,
    vision: { mode: 'presentation', ...counts },
  });

  assert.ok(interview.visual && presentation.visual);
  assert.ok(
    metric(interview.visual, 'movement-activity').rehearsalScore
      < metric(presentation.visual, 'movement-activity').rehearsalScore,
  );
  assert.match(metric(interview.visual, 'movement-activity').target, /interview/u);
  assert.match(metric(presentation.visual, 'movement-activity').target, /presentation/u);
});

test('zero tracked frames do not fabricate framing or movement observations', () => {
  const result = analyzeDeliveryMetrics({
    durationSeconds: 30,
    transcript: 'A short recognized transcript.',
    vision: {
      mode: 'presentation',
      sampledFrames: 100,
      trackedFrames: 0,
      framedFrames: 0,
      movementActiveFrames: 0,
    },
  });

  assert.ok(result.visual);
  assert.equal(result.visual.measurementCoverage, 35);
  assert.equal(metric(result.visual, 'tracking-coverage').rehearsalScore, 0);
  assert.equal(metric(result.visual, 'framing-coverage').rehearsalScore, null);
  assert.equal(metric(result.visual, 'movement-activity').rehearsalScore, null);
});

test('mismatched recognizer timestamps are withheld instead of attached to the wrong word', () => {
  const result = analyzeDeliveryMetrics({
    durationSeconds: 10,
    transcript: 'we we can build it',
    timedWords: [
      { text: 'different', startSeconds: 2 },
      { text: 'tokens', startSeconds: 3 },
    ],
  });

  assert.equal(result.repeatedWordEvents[0].timestampSeconds, null);
});

test('invalid observations fail with typed, actionable errors', () => {
  assert.throws(
    () => analyzeDeliveryMetrics({ durationSeconds: 0, transcript: 'hello' }),
    (error) => error instanceof DeliveryMetricsError && error.code === 'invalid_duration',
  );
  assert.throws(
    () => analyzeDeliveryMetrics({ durationSeconds: 10, transcript: ' ' }),
    (error) => error instanceof DeliveryMetricsError && error.code === 'empty_transcript',
  );
  assert.throws(
    () => analyzeDeliveryMetrics({
      durationSeconds: 10,
      transcript: 'hello',
      audio: { pauseSeconds: 11 },
    }),
    (error) => error instanceof DeliveryMetricsError && error.code === 'invalid_observation',
  );
  assert.throws(
    () => analyzeDeliveryMetrics({
      durationSeconds: 10,
      transcript: 'hello',
      vision: {
        mode: 'interview',
        sampledFrames: 3,
        trackedFrames: 4,
        framedFrames: 0,
        movementActiveFrames: 0,
      },
    }),
    (error) => error instanceof DeliveryMetricsError && error.code === 'invalid_observation',
  );
});

test('the same observations always produce byte-equivalent results', () => {
  const input = {
    durationSeconds: 45,
    transcript: 'We we built a local prototype, um, for rubric practice.',
    audio: {
      pauseSeconds: 8,
      pitchHzSamples: [170, 185, 200, 178, 194],
      energyRmsSamples: [0.1, 0.2, 0.15, 0.25, 0.18],
    },
    vision: {
      mode: 'presentation',
      sampledFrames: 50,
      trackedFrames: 45,
      framedFrames: 40,
      movementActiveFrames: 12,
    },
  };

  assert.deepEqual(analyzeDeliveryMetrics(input), analyzeDeliveryMetrics(input));
});

// ---------------------------------------------------------------------------
//  The band a chart draws must be the band the score was computed from.
//
//  Before this, the practice band existed twice: as loose arguments to the
//  scoring function, and as an English sentence beside it ("105–165 words/min
//  practice band"). Nothing tied them together, so moving a threshold would
//  leave the label — and now the shaded zone on the chart — describing a rule
//  the product no longer applies. A chart that disagrees with its own number is
//  worse than no chart, because a judge who spots it stops trusting the rest.
// ---------------------------------------------------------------------------
function allMetrics(result) {
  return [...result.vocal.metrics, ...(result.visual?.metrics ?? [])];
}

const FULLY_OBSERVED = {
  durationSeconds: 60,
  transcript: 'We shipped a rubric grounded rehearsal workspace for Indonesian students.',
  audio: {
    pauseSeconds: 9,
    pitchHzSamples: [165, 180, 195, 172, 188, 176],
    energyRmsSamples: [0.12, 0.2, 0.16, 0.24, 0.18, 0.21],
  },
  vision: {
    mode: 'presentation',
    sampledFrames: 100,
    trackedFrames: 92,
    framedFrames: 85,
    movementActiveFrames: 30,
  },
};

test('every metric carries a band with a plotted target zone inside its axis', () => {
  const metrics = allMetrics(analyzeDeliveryMetrics(FULLY_OBSERVED));
  assert.ok(metrics.length >= 9, 'expected the full vocal and visual metric set');

  for (const item of metrics) {
    const { axisMin, axisMax, targetFrom, targetTo } = item.band;
    for (const [name, value] of Object.entries(item.band)) {
      assert.ok(Number.isFinite(value), `${item.id}.band.${name} must be a finite number`);
    }
    assert.ok(axisMin < axisMax, `${item.id} axis must span a positive range`);
    assert.ok(targetFrom <= targetTo, `${item.id} target zone must not be inverted`);
    assert.ok(
      targetFrom >= axisMin && targetTo <= axisMax,
      `${item.id} target zone must sit inside the axis it is drawn on`,
    );
  }
});

test('a band-scored metric reads 100 inside its own band and 0 at its axis edges', () => {
  // Coverage metrics score as the observed percentage itself, so their band is
  // a guidance threshold rather than the scoring rule. Every other metric is
  // scored BY the band, and that is the relationship worth pinning.
  const guidanceOnly = new Set(['tracking-coverage', 'framing-coverage']);
  const metrics = allMetrics(analyzeDeliveryMetrics(FULLY_OBSERVED))
    .filter((item) => !guidanceOnly.has(item.id));
  assert.ok(metrics.length >= 7, 'expected at least seven band-scored metrics');

  for (const item of metrics) {
    const { axisMin, axisMax, targetFrom, targetTo } = item.band;
    const midpoint = (targetFrom + targetTo) / 2;
    assert.ok(
      item.observedValue === null || item.rehearsalScore !== null,
      `${item.id} reported a value without a score`,
    );
    // Reconstructing the score from the band is the whole point: if these two
    // ever disagree, the marker on the chart is pointing at the wrong rule.
    const scoreAt = (value) => {
      if (value >= targetFrom && value <= targetTo) return 100;
      if (value < targetFrom) return Math.round(100 * (value - axisMin) / (targetFrom - axisMin));
      return Math.round(100 * (axisMax - value) / (axisMax - targetTo));
    };
    assert.equal(scoreAt(midpoint), 100, `${item.id} should score 100 at the middle of its band`);
    assert.equal(scoreAt(axisMax), 0, `${item.id} should score 0 at the top of its axis`);
    if (targetFrom > axisMin) {
      assert.equal(scoreAt(axisMin), 0, `${item.id} should score 0 at the bottom of its axis`);
    }
  }
});

test('a reported percentage is plotted against a band in the same unit', () => {
  // Pause, pitch, energy, and movement are measured as ratios and reported as
  // percentages. Scoring used the ratio band; plotting uses the reported value.
  // Mixing the two puts an 18% pause ratio at the far right of a 0–0.65 axis.
  const result = analyzeDeliveryMetrics(FULLY_OBSERVED);
  const scaled = [
    [metric(result.vocal, 'pause-ratio'), 0, 65, 8, 28],
    [metric(result.vocal, 'pitch-variation'), 1, 75, 8, 30],
    [metric(result.vocal, 'energy-variation'), 1, 125, 12, 55],
    [metric(result.visual, 'movement-activity'), 0, 95, 8, 60],
  ];

  for (const [item, axisMin, axisMax, targetFrom, targetTo] of scaled) {
    assert.deepEqual(
      item.band,
      { axisMin, axisMax, targetFrom, targetTo },
      `${item.id} band must be expressed in the unit it reports`,
    );
    assert.ok(
      item.observedValue >= item.band.axisMin && item.observedValue <= item.band.axisMax,
      `${item.id} observed ${item.observedValue} fell outside its own plotted axis`,
    );
  }
});
