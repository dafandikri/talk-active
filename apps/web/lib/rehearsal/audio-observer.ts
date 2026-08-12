import { estimatePitchHz, rootMeanSquare } from './pitch';

export type AudioObserverState =
  | 'idle'
  | 'starting'
  | 'observing'
  | 'stopping'
  | 'ended'
  | 'error'
  | 'unsupported'
  | 'disposed';

export interface AudioObservationSample {
  timestampMs: number;
  rms: number;
  decibelsFullScale: number;
  pitchHz: number | null;
  quiet: boolean;
  currentQuietSeconds: number;
  accumulatedQuietSeconds: number;
  accumulatedPauseSeconds: number;
  pauseCount: number;
}

export interface AudioObservationSummary {
  observedSeconds: number;
  quietSeconds: number;
  pauseSeconds: number;
  pauseCount: number;
  pitchSampleCount: number;
  meanPitchHz: number | null;
  pitchStandardDeviationHz: number | null;
  pitchRangeHz: number | null;
  pitchHzSamples: readonly number[];
  energyRmsSamples: readonly number[];
}

export interface AudioObserverFailure {
  code: string;
  message: string;
}

export interface AudioObserverOptions {
  sampleIntervalMs?: number;
  fftSize?: number;
  quietRmsThreshold?: number;
  pauseThresholdMs?: number;
  minimumPitchHz?: number;
  maximumPitchHz?: number;
  minimumPitchRms?: number;
  stopTracksOnDispose?: boolean;
  onSample?: (sample: AudioObservationSample) => void;
  onStateChange?: (state: AudioObserverState) => void;
  onError?: (failure: AudioObserverFailure) => void;
}

export interface AudioObserver {
  readonly supported: boolean;
  readonly state: AudioObserverState;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  reset(): void;
  summary(): AudioObservationSummary;
  dispose(): Promise<void>;
}

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

interface MutableSummary {
  observedSeconds: number;
  quietSeconds: number;
  pauseSeconds: number;
  pauseCount: number;
  pitchSampleCount: number;
  meanPitchHz: number;
  pitchM2: number;
  minimumPitchHz: number;
  maximumPitchHz: number;
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext ?? null;
}

function validFftSize(value: number): number {
  const bounded = Math.max(256, Math.min(32_768, Math.round(value)));
  const exponent = Math.round(Math.log2(bounded));
  return 2 ** exponent;
}

function emptySummary(): MutableSummary {
  return {
    observedSeconds: 0,
    quietSeconds: 0,
    pauseSeconds: 0,
    pauseCount: 0,
    pitchSampleCount: 0,
    meanPitchHz: 0,
    pitchM2: 0,
    minimumPitchHz: Number.POSITIVE_INFINITY,
    maximumPitchHz: Number.NEGATIVE_INFINITY,
  };
}

export function createAudioObserver(
  stream: MediaStream,
  options: AudioObserverOptions = {},
): AudioObserver {
  const Context = audioContextConstructor();
  const audioTracks = stream.getAudioTracks();
  const supported = Context !== null && audioTracks.length > 0;
  let currentState: AudioObserverState = supported ? 'idle' : 'unsupported';
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let timeDomainSamples: Float32Array<ArrayBuffer> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let startToken = 0;
  let disposed = false;
  let startedAtMs = 0;
  let lastSampleAtMs = 0;
  let currentQuietSeconds = 0;
  let inSustainedPause = false;
  let totals = emptySummary();
  let pitchHzSamples: number[] = [];
  let energyRmsSamples: number[] = [];

  const sampleIntervalMs = Math.max(50, Math.min(1_000, options.sampleIntervalMs ?? 200));
  const fftSize = validFftSize(options.fftSize ?? 2_048);
  const quietRmsThreshold = Math.max(0, options.quietRmsThreshold ?? 0.018);
  const pauseThresholdSeconds = Math.max(0.1, (options.pauseThresholdMs ?? 650) / 1_000);
  const minimumPitchHz = Math.max(20, options.minimumPitchHz ?? 70);
  const maximumPitchHz = Math.max(minimumPitchHz + 1, options.maximumPitchHz ?? 450);
  const minimumPitchRms = Math.max(0, options.minimumPitchRms ?? 0.01);

  function setState(next: AudioObserverState) {
    if (currentState === next) return;
    currentState = next;
    options.onStateChange?.(next);
  }

  function reset() {
    totals = emptySummary();
    pitchHzSamples = [];
    energyRmsSamples = [];
    currentQuietSeconds = 0;
    inSustainedPause = false;
    startedAtMs = typeof performance === 'undefined' ? Date.now() : performance.now();
    lastSampleAtMs = startedAtMs;
  }

  function summary(): AudioObservationSummary {
    const pitchVariance = totals.pitchSampleCount > 1
      ? totals.pitchM2 / (totals.pitchSampleCount - 1)
      : null;
    return {
      observedSeconds: totals.observedSeconds,
      quietSeconds: totals.quietSeconds,
      pauseSeconds: totals.pauseSeconds,
      pauseCount: totals.pauseCount,
      pitchSampleCount: totals.pitchSampleCount,
      meanPitchHz: totals.pitchSampleCount > 0 ? totals.meanPitchHz : null,
      pitchStandardDeviationHz: pitchVariance === null ? null : Math.sqrt(pitchVariance),
      pitchRangeHz: totals.pitchSampleCount > 0
        ? totals.maximumPitchHz - totals.minimumPitchHz
        : null,
      pitchHzSamples: [...pitchHzSamples],
      energyRmsSamples: [...energyRmsSamples],
    };
  }

  function observe() {
    if (!analyser || !context || currentState !== 'observing') return;
    const samples = timeDomainSamples;
    if (!samples) return;
    analyser.getFloatTimeDomainData(samples);
    const rms = rootMeanSquare(samples);
    const quiet = rms < quietRmsThreshold;
    if (!quiet) energyRmsSamples.push(rms);
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    // A throttled/background tab cannot classify a long gap from one sample.
    // Cap the represented interval rather than inventing seconds of silence.
    const elapsedSeconds = Math.max(
      0,
      Math.min((now - lastSampleAtMs) / 1_000, sampleIntervalMs * 2.5 / 1_000),
    );
    lastSampleAtMs = now;
    totals.observedSeconds += elapsedSeconds;

    if (quiet) {
      totals.quietSeconds += elapsedSeconds;
      currentQuietSeconds += elapsedSeconds;
      if (!inSustainedPause && currentQuietSeconds >= pauseThresholdSeconds) {
        inSustainedPause = true;
        totals.pauseCount += 1;
        // Once an interval qualifies, count the whole quiet interval.
        totals.pauseSeconds += currentQuietSeconds;
      } else if (inSustainedPause) {
        totals.pauseSeconds += elapsedSeconds;
      }
    } else {
      currentQuietSeconds = 0;
      inSustainedPause = false;
    }

    const pitchHz = quiet ? null : estimatePitchHz(samples, context.sampleRate, {
      minFrequencyHz: minimumPitchHz,
      maxFrequencyHz: maximumPitchHz,
      minimumRms: minimumPitchRms,
    });
    if (pitchHz !== null) {
      pitchHzSamples.push(pitchHz);
      totals.pitchSampleCount += 1;
      const delta = pitchHz - totals.meanPitchHz;
      totals.meanPitchHz += delta / totals.pitchSampleCount;
      totals.pitchM2 += delta * (pitchHz - totals.meanPitchHz);
      totals.minimumPitchHz = Math.min(totals.minimumPitchHz, pitchHz);
      totals.maximumPitchHz = Math.max(totals.maximumPitchHz, pitchHz);
    }

    options.onSample?.({
      timestampMs: Math.max(0, now - startedAtMs),
      rms,
      decibelsFullScale: Math.max(-100, 20 * Math.log10(Math.max(rms, 1e-5))),
      pitchHz,
      quiet,
      currentQuietSeconds,
      accumulatedQuietSeconds: totals.quietSeconds,
      accumulatedPauseSeconds: totals.pauseSeconds,
      pauseCount: totals.pauseCount,
    });
  }

  function removeTrackListeners() {
    for (const track of audioTracks) track.removeEventListener('ended', handleTrackEnded);
  }

  async function releaseNodes() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    removeTrackListeners();
    try { source?.disconnect(); } catch { /* Already disconnected. */ }
    try { analyser?.disconnect(); } catch { /* Already disconnected. */ }
    source = null;
    analyser = null;
    timeDomainSamples = null;
    const closing = context;
    context = null;
    if (closing && closing.state !== 'closed') {
      try { await closing.close(); } catch { /* The browser already released it. */ }
    }
  }

  async function handleTrackEnded() {
    if (disposed || currentState === 'ended') return;
    startToken += 1;
    await releaseNodes();
    setState('ended');
  }

  return {
    supported,
    get state() { return currentState; },
    async start() {
      if (disposed) return false;
      if (!supported || !Context) {
        setState('unsupported');
        options.onError?.({
          code: audioTracks.length === 0 ? 'audio-track-required' : 'web-audio-unsupported',
          message: audioTracks.length === 0
            ? 'The supplied media stream has no audio track.'
            : 'This browser does not support Web Audio observations.',
        });
        return false;
      }
      if (currentState === 'observing') return true;
      if (currentState === 'starting') return false;

      const token = ++startToken;
      setState('starting');
      try {
        context = new Context({ latencyHint: 'interactive' });
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = 0;
        timeDomainSamples = new Float32Array(analyser.fftSize);
        source.connect(analyser);
        await context.resume();
        if (disposed || token !== startToken) {
          await releaseNodes();
          return false;
        }
        if (context.state !== 'running') {
          throw new Error('The browser did not start its audio analysis context.');
        }

        reset();
        for (const track of audioTracks) track.addEventListener('ended', handleTrackEnded, { once: true });
        setState('observing');
        timer = setInterval(observe, sampleIntervalMs);
        observe();
        return true;
      } catch (error) {
        startToken += 1;
        await releaseNodes();
        setState('error');
        options.onError?.({
          code: 'audio-observer-start-failed',
          message: error instanceof Error ? error.message : 'Audio observations could not start.',
        });
        return false;
      }
    },
    async stop() {
      if (disposed || currentState === 'idle' || currentState === 'unsupported') return;
      startToken += 1;
      setState('stopping');
      await releaseNodes();
      if (!disposed) setState('idle');
    },
    reset,
    summary,
    async dispose() {
      if (disposed) return;
      startToken += 1;
      disposed = true;
      await releaseNodes();
      if (options.stopTracksOnDispose) {
        for (const track of audioTracks) track.stop();
      }
      setState('disposed');
    },
  };
}
