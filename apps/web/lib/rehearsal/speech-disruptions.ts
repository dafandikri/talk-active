import { findFillerCues } from './filler-cues.ts';

export type SpeechDisruptionKind =
  | 'prolonged-voicing'
  | 'repeated-start'
  | 'interim-filler';

export type SpeechDisruptionSource =
  | 'acoustic'
  | 'interim-transcript'
  | 'combined';

export interface SpeechDisruptionEvent {
  kind: SpeechDisruptionKind;
  source: SpeechDisruptionSource;
  startMs: number;
  endMs: number;
  durationMs: number;
  label: string;
  evidence: string;
}

export interface DisruptionAudioSample {
  timestampMs: number;
  rms: number;
  pitchHz: number | null;
  quiet: boolean;
}

export interface SpeechDisruptionDetectorOptions {
  ignoreBeforeMs?: number;
  minimumProlongationMs?: number;
  maximumPitchVariation?: number;
  maximumEnergyVariation?: number;
  minimumRepeatedBursts?: number;
  minimumBurstMs?: number;
  maximumBurstMs?: number;
  minimumGapMs?: number;
  maximumGapMs?: number;
}

interface VoicedRun {
  startMs: number;
  endMs: number;
  pitches: number[];
  energies: number[];
}

const DEFAULTS = {
  minimumProlongationMs: 550,
  maximumPitchVariation: 0.18,
  maximumEnergyVariation: 0.45,
  minimumRepeatedBursts: 3,
  minimumBurstMs: 80,
  maximumBurstMs: 420,
  minimumGapMs: 50,
  maximumGapMs: 360,
} as const;

function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length < 3) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return null;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return null;
  if (sorted.length % 2 === 1) return value;
  return ((sorted[middle - 1] ?? value) + value) / 2;
}

function relativeDifference(left: number | null, right: number | null): number {
  if (left === null || right === null || left <= 0 || right <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(left - right) / Math.max(left, right);
}

export class SpeechDisruptionDetector {
  private readonly ignoreBeforeMs: number;
  private readonly minimumProlongationMs: number;
  private readonly maximumPitchVariation: number;
  private readonly maximumEnergyVariation: number;
  private readonly minimumRepeatedBursts: number;
  private readonly minimumBurstMs: number;
  private readonly maximumBurstMs: number;
  private readonly minimumGapMs: number;
  private readonly maximumGapMs: number;
  private readonly detected: SpeechDisruptionEvent[] = [];
  private activeRun: VoicedRun | null = null;
  private repeatedRuns: VoicedRun[] = [];
  private lastTimestampMs: number | null = null;
  private typicalStepMs = 100;
  private finished = false;

  constructor(options: SpeechDisruptionDetectorOptions = {}) {
    this.ignoreBeforeMs = Math.max(0, options.ignoreBeforeMs ?? 0);
    this.minimumProlongationMs = Math.max(400, options.minimumProlongationMs ?? DEFAULTS.minimumProlongationMs);
    this.maximumPitchVariation = Math.max(0.02, options.maximumPitchVariation ?? DEFAULTS.maximumPitchVariation);
    this.maximumEnergyVariation = Math.max(0.05, options.maximumEnergyVariation ?? DEFAULTS.maximumEnergyVariation);
    this.minimumRepeatedBursts = Math.max(3, Math.round(options.minimumRepeatedBursts ?? DEFAULTS.minimumRepeatedBursts));
    this.minimumBurstMs = Math.max(40, options.minimumBurstMs ?? DEFAULTS.minimumBurstMs);
    this.maximumBurstMs = Math.max(this.minimumBurstMs, options.maximumBurstMs ?? DEFAULTS.maximumBurstMs);
    this.minimumGapMs = Math.max(0, options.minimumGapMs ?? DEFAULTS.minimumGapMs);
    this.maximumGapMs = Math.max(this.minimumGapMs, options.maximumGapMs ?? DEFAULTS.maximumGapMs);
  }

  addSample(sample: DisruptionAudioSample): SpeechDisruptionEvent[] {
    if (this.finished || !Number.isFinite(sample.timestampMs) || sample.timestampMs < 0) return [];
    if (sample.timestampMs < this.ignoreBeforeMs) return [];
    const emitted: SpeechDisruptionEvent[] = [];
    if (this.lastTimestampMs !== null) {
      if (sample.timestampMs <= this.lastTimestampMs) return [];
      const gapMs = sample.timestampMs - this.lastTimestampMs;
      if (gapMs > 300) {
        if (this.activeRun) emitted.push(...this.finishRun(this.activeRun));
        this.activeRun = null;
        this.repeatedRuns = [];
        this.typicalStepMs = 100;
      } else {
        this.typicalStepMs = Math.min(250, Math.max(40, gapMs));
      }
    }
    this.lastTimestampMs = sample.timestampMs;
    const voiced = !sample.quiet && sample.pitchHz !== null && sample.pitchHz > 0 && sample.rms > 0;

    if (voiced) {
      if (!this.activeRun) {
        this.activeRun = {
          startMs: sample.timestampMs,
          endMs: sample.timestampMs + this.typicalStepMs,
          pitches: [],
          energies: [],
        };
      }
      this.activeRun.endMs = sample.timestampMs + this.typicalStepMs;
      this.activeRun.pitches.push(sample.pitchHz ?? 0);
      this.activeRun.energies.push(sample.rms);
    } else if (this.activeRun) {
      emitted.push(...this.finishRun(this.activeRun));
      this.activeRun = null;
    } else {
      const lastRepeated = this.repeatedRuns[this.repeatedRuns.length - 1];
      if (lastRepeated && sample.timestampMs - lastRepeated.endMs > this.maximumGapMs) {
        this.repeatedRuns = [];
      }
    }

    this.detected.push(...emitted);
    return emitted;
  }

  finish(endMs = (this.lastTimestampMs ?? 0) + this.typicalStepMs): SpeechDisruptionEvent[] {
    if (this.finished) return [];
    this.finished = true;
    const boundedEndMs = this.activeRun
      ? Math.min(
        Math.max(this.activeRun.endMs, endMs),
        this.activeRun.endMs + this.typicalStepMs,
      )
      : endMs;
    const emitted = this.activeRun
      ? this.finishRun({ ...this.activeRun, endMs: boundedEndMs })
      : [];
    this.activeRun = null;
    this.repeatedRuns = [];
    this.detected.push(...emitted);
    return emitted;
  }

  reset(): void {
    this.detected.length = 0;
    this.activeRun = null;
    this.repeatedRuns = [];
    this.lastTimestampMs = null;
    this.typicalStepMs = 100;
    this.finished = false;
  }

  events(): SpeechDisruptionEvent[] {
    return this.detected.map((event) => ({ ...event }));
  }

  private finishRun(run: VoicedRun): SpeechDisruptionEvent[] {
    const durationMs = Math.max(0, run.endMs - run.startMs);
    const pitchVariation = coefficientOfVariation(run.pitches);
    const energyVariation = coefficientOfVariation(run.energies);
    if (
      durationMs >= this.minimumProlongationMs
      && pitchVariation !== null
      && energyVariation !== null
      && pitchVariation <= this.maximumPitchVariation
      && energyVariation <= this.maximumEnergyVariation
    ) {
      this.repeatedRuns = [];
      return [{
        kind: 'prolonged-voicing',
        source: 'acoustic',
        startMs: Math.round(run.startMs),
        endMs: Math.round(run.endMs),
        durationMs: Math.round(durationMs),
        label: 'Possible prolonged voiced hesitation',
        evidence: `${(durationMs / 1_000).toFixed(1)}s of continuous, acoustically stable voicing.`,
      }];
    }

    if (durationMs < this.minimumBurstMs || durationMs > this.maximumBurstMs) {
      this.repeatedRuns = [];
      return [];
    }

    const previous = this.repeatedRuns[this.repeatedRuns.length - 1];
    if (previous) {
      const gapMs = run.startMs - previous.endMs;
      const similarPitch = relativeDifference(median(previous.pitches), median(run.pitches)) <= 0.22;
      const similarEnergy = relativeDifference(median(previous.energies), median(run.energies)) <= 0.65;
      if (gapMs < this.minimumGapMs || gapMs > this.maximumGapMs || !similarPitch || !similarEnergy) {
        this.repeatedRuns = [];
      }
    }
    this.repeatedRuns.push(run);

    if (this.repeatedRuns.length < this.minimumRepeatedBursts) return [];
    const first = this.repeatedRuns[0];
    const last = this.repeatedRuns[this.repeatedRuns.length - 1];
    if (!first || !last) return [];
    const event: SpeechDisruptionEvent = {
      kind: 'repeated-start',
      source: 'acoustic',
      startMs: Math.round(first.startMs),
      endMs: Math.round(last.endMs),
      durationMs: Math.round(last.endMs - first.startMs),
      label: 'Possible repeated-start pattern',
      evidence: `${this.repeatedRuns.length} similar short voiced bursts separated by brief gaps.`,
    };
    this.repeatedRuns = [];
    return [event];
  }
}

export class InterimFillerTracker {
  private previousCounts = new Map<string, number>();
  private lastEventAt = new Map<string, number>();
  private readonly detected: SpeechDisruptionEvent[] = [];
  private readonly ignoreBeforeMs: number;

  constructor(ignoreBeforeMs = 0) {
    this.ignoreBeforeMs = Math.max(0, ignoreBeforeMs);
  }

  addInterimTranscript(transcript: string, timestampMs: number): SpeechDisruptionEvent[] {
    if (!Number.isFinite(timestampMs) || timestampMs < 0) return [];
    const currentCounts = new Map<string, number>();
    for (const cue of findFillerCues(transcript)) {
      currentCounts.set(cue.label, (currentCounts.get(cue.label) ?? 0) + 1);
    }
    if (timestampMs < this.ignoreBeforeMs) {
      this.previousCounts = currentCounts;
      return [];
    }
    const emitted: SpeechDisruptionEvent[] = [];
    for (const [label, count] of currentCounts) {
      const increase = count - (this.previousCounts.get(label) ?? 0);
      if (increase <= 0) continue;
      const lastAt = this.lastEventAt.get(label) ?? Number.NEGATIVE_INFINITY;
      if (timestampMs - lastAt < 700) continue;
      for (let index = 0; index < increase; index += 1) {
        emitted.push({
          kind: 'interim-filler',
          source: 'interim-transcript',
          startMs: Math.round(timestampMs),
          endMs: Math.round(timestampMs),
          durationMs: 0,
          label: `Possible filler “${label}”`,
          evidence: 'Appeared in a live recognition hypothesis before the browser finalized the transcript.',
        });
      }
      this.lastEventAt.set(label, timestampMs);
    }
    this.previousCounts = currentCounts;
    this.detected.push(...emitted);
    return emitted;
  }

  reset(): void {
    this.previousCounts.clear();
    this.lastEventAt.clear();
    this.detected.length = 0;
  }

  /**
   * Starts a fresh recognition hypothesis without discarding observations
   * already recorded on the session clock. Interview answers need a clean
   * count baseline, but their final review spans every answer.
   */
  beginUtterance(): void {
    this.previousCounts.clear();
  }

  events(): SpeechDisruptionEvent[] {
    return this.detected.map((event) => ({ ...event }));
  }
}

function intervalGap(left: SpeechDisruptionEvent, right: SpeechDisruptionEvent): number {
  return Math.max(0, Math.max(left.startMs, right.startMs) - Math.min(left.endMs, right.endMs));
}

export function mergeSpeechDisruptionEvents(
  ...groups: ReadonlyArray<readonly SpeechDisruptionEvent[]>
): SpeechDisruptionEvent[] {
  const merged: SpeechDisruptionEvent[] = [];
  const ordered = groups.flat().map((event) => ({ ...event })).sort((left, right) => left.startMs - right.startMs);
  for (const candidate of ordered) {
    const match = merged
      .filter((event) => (
        event.source !== candidate.source
        && event.source !== 'combined'
        && candidate.source !== 'combined'
        && intervalGap(event, candidate) <= 700
      ))
      .sort((left, right) => intervalGap(left, candidate) - intervalGap(right, candidate))[0];
    if (!match) {
      merged.push(candidate);
      continue;
    }
    const filler = match.kind === 'interim-filler' ? match : candidate.kind === 'interim-filler' ? candidate : null;
    match.source = 'combined';
    match.kind = filler?.kind ?? match.kind;
    match.startMs = Math.min(match.startMs, candidate.startMs);
    match.endMs = Math.max(match.endMs, candidate.endMs);
    match.durationMs = Math.max(0, match.endMs - match.startMs);
    match.label = filler ? `${filler.label} with an acoustic cue` : match.label;
    match.evidence = `${match.evidence} ${candidate.evidence}`;
  }
  return merged.sort((left, right) => left.startMs - right.startMs);
}
