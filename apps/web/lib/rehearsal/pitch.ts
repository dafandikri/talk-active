export interface PitchEstimateOptions {
  minFrequencyHz?: number;
  maxFrequencyHz?: number;
  minimumRms?: number;
  minimumCorrelation?: number;
}

export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sumOfSquares = 0;
  for (const sample of samples) sumOfSquares += sample * sample;
  return Math.sqrt(sumOfSquares / samples.length);
}

/**
 * Estimates a fundamental frequency from one time-domain buffer.
 *
 * This deliberately returns `null` for silence and weak/ambiguous periodicity.
 * It is an observable acoustic measurement, not a judgment about fluency,
 * emotion, confidence, or speaker identity.
 */
export function estimatePitchHz(
  samples: Float32Array,
  sampleRate: number,
  options: PitchEstimateOptions = {},
): number | null {
  if (samples.length < 3 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;

  const minimumRms = options.minimumRms ?? 0.01;
  const minimumCorrelation = options.minimumCorrelation ?? 0.55;
  const requestedMinimum = options.minFrequencyHz ?? 70;
  const requestedMaximum = options.maxFrequencyHz ?? 450;
  if (
    !Number.isFinite(requestedMinimum)
    || !Number.isFinite(requestedMaximum)
    || requestedMinimum <= 0
    || requestedMaximum <= requestedMinimum
  ) return null;

  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;

  const centered = new Float32Array(samples.length);
  let sumOfSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = (samples[index] ?? 0) - mean;
    centered[index] = value;
    sumOfSquares += value * value;
  }
  if (Math.sqrt(sumOfSquares / samples.length) < minimumRms) return null;

  const minimumLag = Math.max(1, Math.floor(sampleRate / requestedMaximum));
  const maximumLag = Math.min(
    samples.length - 2,
    Math.ceil(sampleRate / requestedMinimum),
  );
  if (maximumLag <= minimumLag) return null;

  const correlations = new Float32Array(maximumLag + 1);
  let strongestLag = -1;
  let strongestCorrelation = Number.NEGATIVE_INFINITY;

  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let product = 0;
    let leadingEnergy = 0;
    let laggedEnergy = 0;
    const comparableLength = centered.length - lag;
    for (let index = 0; index < comparableLength; index += 1) {
      const leading = centered[index] ?? 0;
      const lagged = centered[index + lag] ?? 0;
      product += leading * lagged;
      leadingEnergy += leading * leading;
      laggedEnergy += lagged * lagged;
    }

    const denominator = Math.sqrt(leadingEnergy * laggedEnergy);
    const correlation = denominator > 0 ? product / denominator : 0;
    correlations[lag] = correlation;

    // Prefer the shorter lag when correlations are effectively tied. This
    // avoids selecting a multiple of the fundamental period for clean tones.
    if (correlation > strongestCorrelation + 0.001) {
      strongestCorrelation = correlation;
      strongestLag = lag;
    }
  }

  if (strongestLag < 0 || strongestCorrelation < minimumCorrelation) return null;

  const before = correlations[strongestLag - 1] ?? strongestCorrelation;
  const center = correlations[strongestLag] ?? strongestCorrelation;
  const after = correlations[strongestLag + 1] ?? strongestCorrelation;
  const curvature = before - 2 * center + after;
  const correction = Math.abs(curvature) > 1e-9
    ? Math.max(-0.5, Math.min(0.5, 0.5 * (before - after) / curvature))
    : 0;
  const refinedLag = strongestLag + correction;
  const estimate = sampleRate / refinedLag;

  return Number.isFinite(estimate)
    && estimate >= requestedMinimum
    && estimate <= requestedMaximum
    ? estimate
    : null;
}
