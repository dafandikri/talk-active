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

export interface DeliveryMetricResult {
  id: DeliveryMetricId;
  label: string;
  available: boolean;
  observedValue: number | null;
  unit: string;
  rehearsalScore: number | null;
  weight: number;
  target: string;
  explanation: string;
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

const FILLER_TOKEN_PATTERNS: ReadonlyArray<Readonly<{
  label: string;
  pattern: RegExp;
}>> = [
  { label: 'um', pattern: /^u+m+$/u },
  { label: 'uh', pattern: /^u+h+$/u },
  { label: 'ee', pattern: /^e{2,}$/u },
  { label: 'emm', pattern: /^e+m+$/u },
  { label: 'ah', pattern: /^a+h+$/u },
  { label: 'anu', pattern: /^anu$/u },
  { label: 'kayak', pattern: /^kayak$/u },
  { label: 'gitu', pattern: /^gitu$/u },
  { label: 'basically', pattern: /^basically$/u },
];

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
  return value
    .toLocaleLowerCase('id-ID')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
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
  const matches: FillerMatch[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index]?.value;
    const next = tokens[index + 1]?.value;
    if (current === 'apa' && next === 'ya') {
      matches.push({ label: 'apa ya', tokenIndexes: [index, index + 1] });
      index += 1;
      continue;
    }
    if (!current) continue;
    const definition = FILLER_TOKEN_PATTERNS.find(({ pattern }) => pattern.test(current));
    if (definition) matches.push({ label: definition.label, tokenIndexes: [index] });
  }
  return matches;
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

function scoreAtMost(value: number, fullCreditThrough: number, zeroAt: number): number {
  if (value <= fullCreditThrough) return 100;
  return round(clamp(100 * (zeroAt - value) / (zeroAt - fullCreditThrough), 0, 100));
}

function scoreTargetBand(
  value: number,
  lowerTarget: number,
  upperTarget: number,
  lowerZero: number,
  upperZero: number,
): number {
  if (value >= lowerTarget && value <= upperTarget) return 100;
  if (value < lowerTarget) {
    return round(clamp(100 * (value - lowerZero) / (lowerTarget - lowerZero), 0, 100));
  }
  return round(clamp(100 * (upperZero - value) / (upperZero - upperTarget), 0, 100));
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
  label: string,
  observedValue: number | null,
  unit: string,
  rehearsalScore: number | null,
  weight: number,
  target: string,
  explanation: string,
): DeliveryMetricResult {
  return {
    id,
    label,
    available: observedValue !== null && rehearsalScore !== null,
    observedValue,
    unit,
    rehearsalScore,
    weight,
    target,
    explanation,
  };
}

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

  return makeGroup([
    makeMetric(
      'pace',
      'Speaking pace',
      round(wordsPerMinute),
      'words/min',
      scoreTargetBand(wordsPerMinute, 105, 165, 50, 240),
      0.20,
      '105–165 words/min practice band',
      `${wordCount} recognized words across ${round(durationSeconds, 1)} seconds.`,
    ),
    makeMetric(
      'fillers',
      'Filler frequency',
      round(fillersPerMinute, 1),
      'events/min',
      scoreAtMost(fillersPerMinute, 2, 12),
      0.20,
      'At most 2 detected events/min',
      `${fillerCount} configured filler event${fillerCount === 1 ? '' : 's'} found in the transcript.`,
    ),
    makeMetric(
      'repeated-words',
      'Adjacent repeated words',
      round(repeatsPerHundredWords, 1),
      'events/100 words',
      scoreAtMost(repeatsPerHundredWords, 0.5, 8),
      0.15,
      'At most 0.5 adjacent repeats/100 words',
      `${repeatedWordCount} additional adjacent word occurrence${repeatedWordCount === 1 ? '' : 's'} detected.`,
    ),
    makeMetric(
      'pause-ratio',
      'Pause ratio',
      pauseRatio === null ? null : round(pauseRatio * 100, 1),
      '% of session',
      pauseRatio === null ? null : scoreTargetBand(pauseRatio, 0.08, 0.28, 0, 0.65),
      0.15,
      '8–28% configured practice band',
      pauseRatio === null
        ? 'Audio pause observations were not supplied.'
        : `${round(audio?.pauseSeconds ?? 0, 1)} seconds were marked as pauses.`,
    ),
    makeMetric(
      'pitch-variation',
      'Pitch variation',
      pitchVariation === null ? null : round(pitchVariation * 100, 1),
      'coefficient %',
      pitchVariation === null ? null : scoreTargetBand(pitchVariation, 0.08, 0.30, 0.01, 0.75),
      0.15,
      '8–30% configured variation band',
      pitchVariation === null
        ? 'At least five voiced pitch samples are required.'
        : 'Calculated as standard deviation divided by mean pitch for voiced samples.',
    ),
    makeMetric(
      'energy-variation',
      'Energy variation',
      energyVariation === null ? null : round(energyVariation * 100, 1),
      'coefficient %',
      energyVariation === null ? null : scoreTargetBand(energyVariation, 0.12, 0.55, 0.01, 1.25),
      0.15,
      '12–55% configured variation band',
      energyVariation === null
        ? 'At least five non-silent energy samples are required.'
        : 'Calculated as standard deviation divided by mean RMS energy for non-silent samples.',
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
  const movementTarget = vision.mode === 'presentation'
    ? { lower: 0.08, upper: 0.60, upperZero: 0.95, label: '8–60% presentation practice band' }
    : { lower: 0.02, upper: 0.30, upperZero: 0.80, label: '2–30% interview practice band' };

  return makeGroup([
    makeMetric(
      'tracking-coverage',
      'Tracking coverage',
      trackingRatio === null ? null : round(trackingRatio * 100, 1),
      '% of sampled frames',
      trackingRatio === null ? null : round(trackingRatio * 100),
      0.35,
      'At least 90% of sampled frames',
      trackingRatio === null
        ? 'No camera frames were sampled.'
        : `${vision.trackedFrames} of ${vision.sampledFrames} sampled frames contained usable landmarks.`,
    ),
    makeMetric(
      'framing-coverage',
      'Framing coverage',
      framingRatio === null ? null : round(framingRatio * 100, 1),
      '% of tracked frames',
      framingRatio === null ? null : round(framingRatio * 100),
      0.40,
      'At least 90% of tracked frames',
      framingRatio === null
        ? 'Usable landmarks are required before framing can be measured.'
        : `${vision.framedFrames} of ${vision.trackedFrames} tracked frames met the mode framing rule.`,
    ),
    makeMetric(
      'movement-activity',
      'Movement activity',
      movementRatio === null ? null : round(movementRatio * 100, 1),
      '% of tracked frames',
      movementRatio === null
        ? null
        : scoreTargetBand(
          movementRatio,
          movementTarget.lower,
          movementTarget.upper,
          0,
          movementTarget.upperZero,
        ),
      0.25,
      movementTarget.label,
      movementRatio === null
        ? 'Usable landmarks are required before movement can be measured.'
        : `${vision.movementActiveFrames} tracked frames crossed the calibrated movement threshold.`,
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
