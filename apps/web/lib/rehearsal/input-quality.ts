/**
 * Is this microphone worth rehearsing into?
 *
 * Browser speech recognition runs on its own capture pipeline. `webkitSpeechRecognition`
 * accepts no MediaStream, so the echoCancellation / noiseSuppression /
 * autoGainControl constraints the studio sets apply to our recording and
 * analysis stream and never to the recognizer. There is no knob to turn on the
 * transcription itself. What we can do is notice, from the stream we DO
 * control, that the input is bad — and say so before someone rehearses into it
 * and gets a transcript full of words they never said.
 *
 * That matters beyond convenience. INV-3 renders a cited span as a blockquote
 * attributed to the speaker. A mistranscription quoted back at a student is
 * fabricated evidence with their name on it, which is the one thing this
 * product exists not to produce.
 *
 * What this can and cannot detect, stated plainly because the difference
 * matters when reading the verdict:
 *
 *   - CAN: no signal, a level pinned near full scale, speech too faint to
 *     segment, and a noise floor that never drops between phrases — which is
 *     what a handled or vibrating microphone actually looks like in level data.
 *   - CANNOT: echo, reverb, or room acoustics. Those need spectral analysis
 *     this module does not do, and claiming otherwise would be an INV-2
 *     overclaim. A room with bad echo can still read as `usable` here.
 */

/**
 * Deliberately narrow. The observer's sample carries pitch, pause counters and
 * timestamps; none of them belong in a level judgement, and a wider parameter
 * would invite them in later.
 */
export interface AudioQualitySample {
  readonly rms: number;
}

export type InputQualityCode =
  | 'usable'
  | 'insufficient'
  | 'silent'
  | 'clipping'
  | 'noisy-floor'
  | 'too-quiet';

export interface InputQualityVerdict {
  readonly code: InputQualityCode;
  /** Whether this is worth interrupting someone about. */
  readonly actionable: boolean;
  /** The measurements behind the verdict, so the message can quote them. */
  readonly values: Readonly<Record<string, number>>;
}

/** Roughly 1.5 seconds at the observer's default cadence. */
export const MINIMUM_QUALITY_SAMPLES = 15;

/** Below this peak nothing is arriving at all — muted, or the wrong device. */
const SILENT_PEAK = 0.005;
/** Speech present but too faint for the recognizer to segment reliably. */
const FAINT_PEAK = 0.02;
/** A sustained level this high is distorting, whatever the source. */
const HOT_RMS = 0.5;
/** Share of samples above HOT_RMS that counts as sustained rather than a knock. */
const HOT_SHARE = 0.05;
/**
 * A quiet moment between phrases should be near-silent. When the quietest
 * quarter of a session still reads this high, the microphone is picking up
 * something continuously — handling, vibration, or room rumble — and the
 * recognizer has no silence to segment on.
 */
const NOISY_FLOOR = 0.03;

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

function verdict(
  code: InputQualityCode,
  actionable: boolean,
  values: Readonly<Record<string, number>>,
): InputQualityVerdict {
  return { code, actionable, values };
}

export function assessInputQuality(
  samples: readonly AudioQualitySample[],
): InputQualityVerdict {
  const levels = samples
    .map((sample) => sample.rms)
    .filter((rms) => Number.isFinite(rms) && rms >= 0);

  if (levels.length < MINIMUM_QUALITY_SAMPLES) {
    // Saying "your microphone is bad" after listening for a fraction of a
    // second would be worse than saying nothing, so this is never actionable.
    return verdict('insufficient', false, { observed: levels.length });
  }

  const sorted = [...levels].sort((left, right) => left - right);
  const peak = sorted[sorted.length - 1] ?? 0;
  // The floor is the quietest quarter rather than the single lowest reading:
  // one lucky sample between two words is not evidence the mic goes quiet.
  const floor = percentile(sorted, 0.25);
  const hotShare = levels.filter((rms) => rms >= HOT_RMS).length / levels.length;
  const values = { peak, floor, hotShare };

  if (peak < SILENT_PEAK) return verdict('silent', true, values);
  // Clipping is checked before the floor because a distorting mic also has a
  // high floor, and reporting the floor would send someone to fix the wrong
  // thing — they need to move back or turn the gain down, not stop touching it.
  if (hotShare >= HOT_SHARE) return verdict('clipping', true, values);
  if (floor >= NOISY_FLOOR) return verdict('noisy-floor', true, values);
  if (peak < FAINT_PEAK) return verdict('too-quiet', true, values);
  return verdict('usable', false, values);
}
