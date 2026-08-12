import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampObservedSeconds,
  clearRawObservationRetention,
  deriveCaptureResultWithCleanup,
} from '../apps/web/lib/rehearsal/raw-observation-retention.ts';

test('raw observation cleanup scrubs sample aliases, React state, and the landmark canvas', () => {
  const pitchValues = [181, 194, 203];
  const energyValues = [0.12, 0.18, 0.16];
  const pitchSamples = { current: pitchValues };
  const energySamples = { current: energyValues };
  const stateUpdates = [];
  const clearCalls = [];
  const canvas = {
    width: 640,
    height: 360,
    getContext: () => ({
      clearRect: (...bounds) => clearCalls.push(bounds),
    }),
  };

  clearRawObservationRetention({
    pitchSamples,
    energySamples,
    canvas,
    clearReactState: true,
    setFrame: (value) => stateUpdates.push(['frame', value]),
    setAudioSample: (value) => stateUpdates.push(['audio', value]),
  });

  assert.equal(pitchSamples.current, pitchValues, 'the retained array itself is scrubbed');
  assert.equal(energySamples.current, energyValues, 'the retained array itself is scrubbed');
  assert.deepEqual(pitchValues, []);
  assert.deepEqual(energyValues, []);
  assert.deepEqual(stateUpdates, [['frame', null], ['audio', null]]);
  assert.deepEqual(clearCalls, [[0, 0, 640, 360]]);
});

test('unmount cleanup scrubs raw buffers without scheduling React state updates', () => {
  const pitchSamples = { current: [220] };
  const energySamples = { current: [0.2] };
  let stateUpdates = 0;

  clearRawObservationRetention({
    pitchSamples,
    energySamples,
    canvas: null,
    clearReactState: false,
    setFrame: () => { stateUpdates += 1; },
    setAudioSample: () => { stateUpdates += 1; },
  });

  assert.deepEqual(pitchSamples.current, []);
  assert.deepEqual(energySamples.current, []);
  assert.equal(stateUpdates, 0);
});

test('metric derivation failure still releases media, scrubs raw state, and resets capture flags', async () => {
  const pitchSamples = { current: [181, 194] };
  const energySamples = { current: [0.12, 0.18] };
  const events = [];
  let active = true;
  let loading = true;

  await assert.rejects(
    deriveCaptureResultWithCleanup({
      derive: () => {
        events.push('derive');
        throw new Error('invalid delivery metric input');
      },
      release: () => {
        events.push('release media');
        clearRawObservationRetention({
          pitchSamples,
          energySamples,
          canvas: null,
          clearReactState: true,
          setFrame: () => events.push('clear frame'),
          setAudioSample: () => events.push('clear audio sample'),
        });
      },
      reset: () => {
        events.push('reset capture flags');
        active = false;
        loading = false;
      },
    }),
    /invalid delivery metric input/,
  );

  assert.deepEqual(events, [
    'derive',
    'release media',
    'clear frame',
    'clear audio sample',
    'reset capture flags',
  ]);
  assert.deepEqual(pitchSamples.current, []);
  assert.deepEqual(energySamples.current, []);
  assert.equal(active, false);
  assert.equal(loading, false);
});

test('observed pause duration is bounded to the capture duration', () => {
  assert.equal(clampObservedSeconds(8.4, 3.2), 3.2);
  assert.equal(clampObservedSeconds(1.4, 3.2), 1.4);
  assert.equal(clampObservedSeconds(-1, 3.2), 0);
});
