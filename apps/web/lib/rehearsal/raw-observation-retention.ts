interface MutableObservationSamples {
  current: number[];
}

interface RawObservationRetentionOptions {
  pitchSamples: MutableObservationSamples;
  energySamples: MutableObservationSamples;
  canvas: HTMLCanvasElement | null;
  clearReactState: boolean;
  setFrame: (frame: null) => void;
  setAudioSample: (sample: null) => void;
}

interface CaptureCleanupOptions<Result> {
  derive: () => Promise<Result> | Result;
  release: () => Promise<void> | void;
  reset: () => void;
}

export function clearRawObservationRetention({
  pitchSamples,
  energySamples,
  canvas,
  clearReactState,
  setFrame,
  setAudioSample,
}: RawObservationRetentionOptions): void {
  pitchSamples.current.length = 0;
  energySamples.current.length = 0;

  if (clearReactState) {
    setFrame(null);
    setAudioSample(null);
  }

  if (canvas) {
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export async function deriveCaptureResultWithCleanup<Result>({
  derive,
  release,
  reset,
}: CaptureCleanupOptions<Result>): Promise<Result> {
  try {
    return await derive();
  } finally {
    try {
      await release();
    } finally {
      reset();
    }
  }
}

export function clampObservedSeconds(observedSeconds: number, durationSeconds: number): number {
  return Math.min(Math.max(0, observedSeconds), Math.max(0, durationSeconds));
}
