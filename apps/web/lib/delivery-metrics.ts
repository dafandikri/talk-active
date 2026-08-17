import { matchFillerTokens, tokenizeSpeech } from './rehearsal/filler-cues.ts';

export type VisionMode = 'interview' | 'presentation';

export interface TimedTranscriptWord {
  text: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface AudioObservations {
  /** Total silence measured by the audio processor, excluding pre/post-roll. */
  pauseSeconds?: number;
  /** Fundamental-frequency samples. Zero denotes an unvoiced sample. */
  pitchHzSamples?: readonly number[];
  /** Root-mean-square energy samples. Zero denotes silence. */
  energyRmsSamples?: readonly number[];
}

export interface VisionObservations {
  mode: VisionMode;
  sampledFrames: number;
  trackedFrames: number;
  framedFrames: number;
  movementActiveFrames: number;
}

export interface DeliveryMetricsInput {
  durationSeconds: number;
  transcript: string;
  /** Optional token timestamps supplied by a speech recognizer. */
  timedWords?: readonly TimedTranscriptWord[];
  audio?: AudioObservations;
  vision?: VisionObservations;
}

export type DeliveryMetricId =
  | 'pace'
  | 'fillers'
  | 'repeated-words'
  | 'pause-ratio'
  | 'pitch-variation'
  | 'energy-variation'
  | 'tracking-coverage'
  | 'framing-coverage'
  | 'movement-activity';

/**
 * A sentence this module does not write.
 *
 * Metric labels, units, target phrasings and explanations are INTERFACE
 * vocabulary — "Filler frequency" describes the chart, not the rehearsal — so
 * they follow the reader's interface locale, not the project language that
 * governs rubric verdicts. Those are two different axes, and a metrics module
 * is the wrong place to resolve either one. It emits a stable id, the variant
 * that applies, and the numbers the sentence interpolates; the component looks
 * the wording up.
 */
export interface DeliveryMetricCopy {
  /** Catalogue variant under this metric, or null when there is only one. */
  readonly variant: string | null;
  /** Values the sentence interpolates. */
  readonly values: Readonly<Record<string, number>>;
}

export interface DeliveryMetricResult {
  id: DeliveryMetricId;
  available: boolean;
  observedValue: number | null;
  rehearsalScore: number | null;
  weight: number;
  band: DeliveryMetricBand;
  target: DeliveryMetricCopy;
  explanation: DeliveryMetricCopy;
}

export interface DeliveryMetricGroup {
  rehearsalScore: number | null;
  measurementCoverage: number;
  metrics: DeliveryMetricResult[];
}

export interface FillerBreakdown {
  label: string;
  count: number;
}

export interface RepeatedWordEvent {
  word: string;
  additionalOccurrences: number;
  tokenIndex: number;
  timestampSeconds: number | null;
}

export interface DeliveryMetricsResult {
  durationSeconds: number;
  wordCount: number;
  wordsPerMinute: number;
  fillerCount: number;
  fillers: FillerBreakdown[];
  repeatedWordCount: number;
  repeatedWordEvents: RepeatedWordEvent[];
  vocal: DeliveryMetricGroup;
  visual: DeliveryMetricGroup | null;
  overallRehearsalScore: number | null;
  measurementCoverage: number;
  boundary: string;
}

export class DeliveryMetricsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DeliveryMetricsError';
    this.code = code;
  }
}

interface NormalizedToken {
  value: string;
  timestampSeconds: number | null;
}

interface FillerMatch {
  label: string;
  tokenIndexes: number[];
}

interface WeightedComponent {
  score: number | null;
  weight: number;
}

const BOUNDARY = 'These are configurable rehearsal heuristics from observable speech and camera signals. '
  + 'They do not infer emotion, personality, intent, health, or speaking ability; repeated-word events '
  + 'can also come from deliberate repetition or transcription errors.';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function tokenize(value: string): string[] {
  return tokenizeSpeech(value);
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new DeliveryMetricsError('invalid_observation', `${field} must be a finite non-negative number.`);
  }
}

function validateSamples(samples: readonly number[] | undefined, field: string): void {
  if (!samples) return;
  for (const value of samples) assertFiniteNonNegative(value, field);
}

function validateTimedWords(
  timedWords: readonly TimedTranscriptWord[] | undefined,
  durationSeconds: number,
): void {
  if (!timedWords) return;
  for (const word of timedWords) {
    if (typeof word.text !== 'string' || tokenize(word.text).length === 0) {
      throw new DeliveryMetricsError('invalid_timed_word', 'Each timed word must contain a word token.');
    }
    if (word.startSeconds !== undefined) {
      assertFiniteNonNegative(word.startSeconds, 'timedWords.startSeconds');
      if (word.startSeconds > durationSeconds) {
        throw new DeliveryMetricsError('invalid_timed_word', 'A word timestamp exceeds the session duration.');
      }
    }
    if (word.endSeconds !== undefined) {
      assertFiniteNonNegative(word.endSeconds, 'timedWords.endSeconds');
      if (word.endSeconds > durationSeconds) {
        throw new DeliveryMetricsError('invalid_timed_word', 'A word timestamp exceeds the session duration.');
      }
      if (word.startSeconds !== undefined && word.endSeconds < word.startSeconds) {
        throw new DeliveryMetricsError('invalid_timed_word', 'A word end timestamp precedes its start.');
      }
    }
  }
}

function normalizeTokens(
  transcript: string,
  timedWords: readonly TimedTranscriptWord[] | undefined,
): NormalizedToken[] {
  const transcriptTokens = tokenize(transcript);
  if (!timedWords || timedWords.length === 0) {
    return transcriptTokens.map((value) => ({ value, timestampSeconds: null }));
  }

  const timedTokens = timedWords.flatMap((word) => tokenize(word.text).map((value) => ({
    value,
    timestampSeconds: word.startSeconds ?? null,
  })));
  const timestampsAlign = timedTokens.length === transcriptTokens.length
    && timedTokens.every((token, index) => token.value === transcriptTokens[index]);

  return transcriptTokens.map((value, index) => ({
    value,
    timestampSeconds: timestampsAlign ? (timedTokens[index]?.timestampSeconds ?? null) : null,
  }));
}

function findFillers(tokens: readonly NormalizedToken[]): FillerMatch[] {
  return matchFillerTokens(tokens.map((token) => token.value));
}

function summarizeFillers(matches: readonly FillerMatch[]): FillerBreakdown[] {
  const counts = new Map<string, number>();
  for (const match of matches) counts.set(match.label, (counts.get(match.label) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count }));
}

function findRepeatedWords(
  tokens: readonly NormalizedToken[],
  fillerTokenIndexes: ReadonlySet<number>,
): RepeatedWordEvent[] {
  const events: RepeatedWordEvent[] = [];
  let index = 1;
  while (index < tokens.length) {
    const current = tokens[index];
    const previous = tokens[index - 1];
    if (!current || !previous || current.value !== previous.value
      || fillerTokenIndexes.has(index) || fillerTokenIndexes.has(index - 1)) {
      index += 1;
      continue;
    }

    const firstRepeatIndex = index;
    let additionalOccurrences = 1;
    while (index + 1 < tokens.length
      && tokens[index + 1]?.value === current.value
      && !fillerTokenIndexes.has(index + 1)) {
      additionalOccurrences += 1;
      index += 1;
    }
    events.push({
      word: current.value,
      additionalOccurrences,
      tokenIndex: firstRepeatIndex,
      timestampSeconds: current.timestampSeconds,
    });
    index += 1;
  }
  return events;
}

/**
 * The four numbers a practice band is made of, in the metric's own unit.
 *
 * These used to be loose arguments to the scoring functions, and the band the
 * user saw was a hand-written string beside them ("105–165 words/min"). Two
 * copies of the same fact drift: changing the score would leave the label
 * describing the old band, and nothing would fail. Now the band is the value
 * the score is computed FROM and the value the chart is drawn FROM, so a
 * changed threshold moves the marker and the shaded zone together.
 */
export interface DeliveryMetricBand {
  /** Lowest value the axis renders; scores zero for a lower-bounded metric. */
  readonly axisMin: number;
  /** Highest value the axis renders; scores zero. */
  readonly axisMax: number;
  /** Start of the configured practice band. */
  readonly targetFrom: number;
  /** End of the configured practice band. */
  readonly targetTo: number;
}

function bandAtMost(fullCreditThrough: number, zeroAt: number): DeliveryMetricBand {
  return { axisMin: 0, axisMax: zeroAt, targetFrom: 0, targetTo: fullCreditThrough };
}

function bandBetween(
  lowerTarget: number,
  upperTarget: number,
  lowerZero: number,
  upperZero: number,
): DeliveryMetricBand {
  return { axisMin: lowerZero, axisMax: upperZero, targetFrom: lowerTarget, targetTo: upperTarget };
}

/** Higher is better, and the score is the observed percentage itself. */
function bandAtLeast(fullCreditFrom: number): DeliveryMetricBand {
  return { axisMin: 0, axisMax: 100, targetFrom: fullCreditFrom, targetTo: 100 };
}

function scoreAtMost(value: number, band: DeliveryMetricBand): number {
  if (value <= band.targetTo) return 100;
  return round(clamp(100 * (band.axisMax - value) / (band.axisMax - band.targetTo), 0, 100));
}

function scoreTargetBand(value: number, band: DeliveryMetricBand): number {
  if (value >= band.targetFrom && value <= band.targetTo) return 100;
  if (value < band.targetFrom) {
    return round(clamp(100 * (value - band.axisMin) / (band.targetFrom - band.axisMin), 0, 100));
  }
  return round(clamp(100 * (band.axisMax - value) / (band.axisMax - band.targetTo), 0, 100));
}

function coefficientOfVariation(samples: readonly number[] | undefined): number | null {
  if (!samples) return null;
  const voiced = samples.filter((sample) => sample > 0);
  if (voiced.length < 5) return null;
  const mean = voiced.reduce((sum, value) => sum + value, 0) / voiced.length;
  if (mean === 0) return null;
  const variance = voiced.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / voiced.length;
  return Math.sqrt(variance) / mean;
}

function makeMetric(
  id: DeliveryMetricId,
  observedValue: number | null,
  rehearsalScore: number | null,
  weight: number,
  band: DeliveryMetricBand,
  explanation: DeliveryMetricCopy,
  target: DeliveryMetricCopy = { variant: null, values: {} },
): DeliveryMetricResult {
  return {
    id,
    available: observedValue !== null && rehearsalScore !== null,
    observedValue,
    rehearsalScore,
    weight,
    band,
    target,
    explanation,
  };
}

/** Most targets are phrased entirely from the band the metric already carries. */
function bandTarget(band: DeliveryMetricBand): DeliveryMetricCopy {
  return { variant: null, values: { from: band.targetFrom, to: band.targetTo } };
}

function measured(values: Readonly<Record<string, number>> = {}): DeliveryMetricCopy {
  return { variant: 'measured', values };
}

const ABSENT: DeliveryMetricCopy = { variant: 'absent', values: {} };

function weightedResult(components: readonly WeightedComponent[]): {
  score: number | null;
  coverage: number;
} {
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const available = components.filter((component) => component.score !== null);
  const availableWeight = available.reduce((sum, component) => sum + component.weight, 0);
  if (totalWeight === 0 || availableWeight === 0) return { score: null, coverage: 0 };
  const weightedTotal = available.reduce(
    (sum, component) => sum + (component.score ?? 0) * component.weight,
    0,
  );
  return {
    score: round(weightedTotal / availableWeight),
    coverage: round(100 * availableWeight / totalWeight),
  };
}

function makeGroup(metrics: DeliveryMetricResult[]): DeliveryMetricGroup {
  const result = weightedResult(metrics.map((metric) => ({
    score: metric.rehearsalScore,
    weight: metric.weight,
  })));
  return {
    rehearsalScore: result.score,
    measurementCoverage: result.coverage,
    metrics,
  };
}

function vocalMetrics(
  durationSeconds: number,
  wordCount: number,
  fillerCount: number,
  repeatedWordCount: number,
  audio: AudioObservations | undefined,
): DeliveryMetricGroup {
  const minutes = durationSeconds / 60;
  const wordsPerMinute = wordCount / minutes;
  const fillersPerMinute = fillerCount / minutes;
  const repeatsPerHundredWords = 100 * repeatedWordCount / Math.max(wordCount, 1);
  const pauseRatio = audio?.pauseSeconds === undefined
    ? null
    : audio.pauseSeconds / durationSeconds;
  const pitchVariation = coefficientOfVariation(audio?.pitchHzSamples);
  const energyVariation = coefficientOfVariation(audio?.energyRmsSamples);

  // Each band is declared once, then handed to both the score and the metric.
  // The chart reads the same object, so the shaded zone can never describe a
  // threshold the score no longer uses.
  const paceBand = bandBetween(105, 165, 50, 240);
  const fillerBand = bandAtMost(2, 12);
  const repeatBand = bandAtMost(0.5, 8);
  const pauseBand = bandBetween(0.08, 0.28, 0, 0.65);
  const pitchBand = bandBetween(0.08, 0.30, 0.01, 0.75);
  const energyBand = bandBetween(0.12, 0.55, 0.01, 1.25);

  // Three of these are measured as ratios and reported as percentages. The
  // chart plots the reported value, so the band has to be scaled the same way
  // or the marker lands in the wrong place.
  const asPercent = (band: DeliveryMetricBand): DeliveryMetricBand => ({
    axisMin: round(band.axisMin * 100, 1),
    axisMax: round(band.axisMax * 100, 1),
    targetFrom: round(band.targetFrom * 100, 1),
    targetTo: round(band.targetTo * 100, 1),
  });

  return makeGroup([
    makeMetric(
      'pace',
      round(wordsPerMinute),
      scoreTargetBand(wordsPerMinute, paceBand),
      0.20,
      paceBand,
      measured({ words: wordCount, seconds: round(durationSeconds, 1) }),
      bandTarget(paceBand),
    ),
    makeMetric(
      'fillers',
      round(fillersPerMinute, 1),
      scoreAtMost(fillersPerMinute, fillerBand),
      0.20,
      fillerBand,
      measured({ count: fillerCount }),
      bandTarget(fillerBand),
    ),
    makeMetric(
      'repeated-words',
      round(repeatsPerHundredWords, 1),
      scoreAtMost(repeatsPerHundredWords, repeatBand),
      0.15,
      repeatBand,
      measured({ count: repeatedWordCount }),
      bandTarget(repeatBand),
    ),
    makeMetric(
      'pause-ratio',
      pauseRatio === null ? null : round(pauseRatio * 100, 1),
      pauseRatio === null ? null : scoreTargetBand(pauseRatio, pauseBand),
      0.15,
      asPercent(pauseBand),
      pauseRatio === null ? ABSENT : measured({ seconds: round(audio?.pauseSeconds ?? 0, 1) }),
      bandTarget(asPercent(pauseBand)),
    ),
    makeMetric(
      'pitch-variation',
      pitchVariation === null ? null : round(pitchVariation * 100, 1),
      pitchVariation === null ? null : scoreTargetBand(pitchVariation, pitchBand),
      0.15,
      asPercent(pitchBand),
      pitchVariation === null ? ABSENT : measured(),
      bandTarget(asPercent(pitchBand)),
    ),
    makeMetric(
      'energy-variation',
      energyVariation === null ? null : round(energyVariation * 100, 1),
      energyVariation === null ? null : scoreTargetBand(energyVariation, energyBand),
      0.15,
      asPercent(energyBand),
      energyVariation === null ? ABSENT : measured(),
      bandTarget(asPercent(energyBand)),
    ),
  ]);
}

function visualMetrics(vision: VisionObservations): DeliveryMetricGroup {
  const trackingRatio = vision.sampledFrames === 0
    ? null
    : vision.trackedFrames / vision.sampledFrames;
  const framingRatio = vision.trackedFrames === 0
    ? null
    : vision.framedFrames / vision.trackedFrames;
  const movementRatio = vision.trackedFrames === 0
    ? null
    : vision.movementActiveFrames / vision.trackedFrames;
  // The one target whose phrasing depends on more than its own band: the
  // practice band differs by mode, and naming which mode's rule the shaded
  // zone draws is the point of the label.
  const movementTarget = vision.mode === 'presentation'
    ? { band: bandBetween(0.08, 0.60, 0, 0.95), variant: 'targetPresentation' }
    : { band: bandBetween(0.02, 0.30, 0, 0.80), variant: 'targetInterview' };
  const movementPercentBand: DeliveryMetricBand = {
    axisMin: round(movementTarget.band.axisMin * 100, 1),
    axisMax: round(movementTarget.band.axisMax * 100, 1),
    targetFrom: round(movementTarget.band.targetFrom * 100, 1),
    targetTo: round(movementTarget.band.targetTo * 100, 1),
  };

  return makeGroup([
    makeMetric(
      'tracking-coverage',
      trackingRatio === null ? null : round(trackingRatio * 100, 1),
      trackingRatio === null ? null : round(trackingRatio * 100),
      0.35,
      bandAtLeast(90),
      trackingRatio === null ? ABSENT : measured({ tracked: vision.trackedFrames, sampled: vision.sampledFrames }),
      bandTarget(bandAtLeast(90)),
    ),
    makeMetric(
      'framing-coverage',
      framingRatio === null ? null : round(framingRatio * 100, 1),
      framingRatio === null ? null : round(framingRatio * 100),
      0.40,
      bandAtLeast(90),
      framingRatio === null ? ABSENT : measured({ framed: vision.framedFrames, tracked: vision.trackedFrames }),
      bandTarget(bandAtLeast(90)),
    ),
    makeMetric(
      'movement-activity',
      movementRatio === null ? null : round(movementRatio * 100, 1),
      movementRatio === null ? null : scoreTargetBand(movementRatio, movementTarget.band),
      0.25,
      movementPercentBand,
      movementRatio === null ? ABSENT : measured({ active: vision.movementActiveFrames }),
      { variant: movementTarget.variant, values: { from: movementPercentBand.targetFrom, to: movementPercentBand.targetTo } },
    ),
  ]);
}

function validateInput(input: DeliveryMetricsInput): void {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new DeliveryMetricsError('invalid_duration', 'Session duration must be greater than zero.');
  }
  if (typeof input.transcript !== 'string' || tokenize(input.transcript).length === 0) {
    throw new DeliveryMetricsError('empty_transcript', 'A recognized transcript is required.');
  }
  validateTimedWords(input.timedWords, input.durationSeconds);
  if (input.audio?.pauseSeconds !== undefined) {
    assertFiniteNonNegative(input.audio.pauseSeconds, 'audio.pauseSeconds');
    if (input.audio.pauseSeconds > input.durationSeconds) {
      throw new DeliveryMetricsError('invalid_observation', 'Pause time cannot exceed session duration.');
    }
  }
  validateSamples(input.audio?.pitchHzSamples, 'audio.pitchHzSamples');
  validateSamples(input.audio?.energyRmsSamples, 'audio.energyRmsSamples');

  if (!input.vision) return;
  if (input.vision.mode !== 'interview' && input.vision.mode !== 'presentation') {
    throw new DeliveryMetricsError('invalid_observation', 'Vision mode must be interview or presentation.');
  }
  for (const [field, value] of Object.entries({
    sampledFrames: input.vision.sampledFrames,
    trackedFrames: input.vision.trackedFrames,
    framedFrames: input.vision.framedFrames,
    movementActiveFrames: input.vision.movementActiveFrames,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DeliveryMetricsError('invalid_observation', `vision.${field} must be a non-negative integer.`);
    }
  }
  if (input.vision.trackedFrames > input.vision.sampledFrames) {
    throw new DeliveryMetricsError('invalid_observation', 'Tracked frames cannot exceed sampled frames.');
  }
  if (input.vision.framedFrames > input.vision.trackedFrames) {
    throw new DeliveryMetricsError('invalid_observation', 'Framed frames cannot exceed tracked frames.');
  }
  if (input.vision.movementActiveFrames > input.vision.trackedFrames) {
    throw new DeliveryMetricsError('invalid_observation', 'Movement frames cannot exceed tracked frames.');
  }
}

export function analyzeDeliveryMetrics(input: DeliveryMetricsInput): DeliveryMetricsResult {
  validateInput(input);
  const tokens = normalizeTokens(input.transcript, input.timedWords);
  const fillerMatches = findFillers(tokens);
  const fillerTokenIndexes = new Set(fillerMatches.flatMap((match) => match.tokenIndexes));
  const repeatedWordEvents = findRepeatedWords(tokens, fillerTokenIndexes);
  const fillerCount = fillerMatches.length;
  const repeatedWordCount = repeatedWordEvents.reduce(
    (sum, event) => sum + event.additionalOccurrences,
    0,
  );
  const vocal = vocalMetrics(
    input.durationSeconds,
    tokens.length,
    fillerCount,
    repeatedWordCount,
    input.audio,
  );
  const visual = input.vision ? visualMetrics(input.vision) : null;
  const overallComponents: WeightedComponent[] = [
    { score: vocal.rehearsalScore, weight: visual ? 0.60 : 1 },
  ];
  if (visual) overallComponents.push({ score: visual.rehearsalScore, weight: 0.40 });
  const overall = weightedResult(overallComponents);
  const modalityCoverage = visual
    ? round((vocal.measurementCoverage * 0.60) + (visual.measurementCoverage * 0.40))
    : vocal.measurementCoverage;

  return {
    durationSeconds: input.durationSeconds,
    wordCount: tokens.length,
    wordsPerMinute: round(tokens.length / (input.durationSeconds / 60)),
    fillerCount,
    fillers: summarizeFillers(fillerMatches),
    repeatedWordCount,
    repeatedWordEvents,
    vocal,
    visual,
    overallRehearsalScore: overall.score,
    measurementCoverage: modalityCoverage,
    boundary: BOUNDARY,
  };
}
