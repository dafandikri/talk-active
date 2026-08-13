/**
 * Where each criterion was earned inside one attempt.
 *
 * Two levels, and they degrade separately on purpose:
 *
 *   1. Character offsets. Always available for a grounded citation, because
 *      grounding already proved the span is verbatim. This drives marking the
 *      quote inside the transcript.
 *   2. An estimated clock position. Only available when the transcript came
 *      from dictation, because a typed transcript has no relationship to the
 *      recording. This drives the lane marks and the replay seek.
 *
 * The state vocabulary matches the evidence map on the review screen —
 * `found` / `absent` / `reused` — so one idea does not grow two languages.
 */

import { findGroundedRange } from '../grounding.ts';
import {
  estimateRangeTiming,
  type TranscriptTimingPoint,
} from './transcript-timing.ts';

export type RubricMomentState = 'found' | 'absent' | 'reused';

export interface RubricTimelineCriterion {
  id: string;
  label: string;
  /** The grounded citation for this criterion, or null when none was found. */
  citedSpan: string | null;
  /** True when this exact span was also cited for another criterion. */
  reused?: boolean;
}

export interface LocatedEvidence {
  span: string;
  charStart: number;
  charEnd: number;
  /** Estimated speaking time, or null when the transcript was typed. */
  startMs: number | null;
  endMs: number | null;
}

export interface RubricTimelineEntry {
  criterionId: string;
  label: string;
  state: RubricMomentState;
  evidence: LocatedEvidence | null;
}

export function buildRubricTimeline(
  criteria: readonly RubricTimelineCriterion[],
  transcript: string,
  timingPoints?: readonly TranscriptTimingPoint[],
): RubricTimelineEntry[] {
  const timed = timingPoints && timingPoints.length > 0 ? timingPoints : null;
  return criteria.map((criterion) => {
    const range = criterion.citedSpan
      ? findGroundedRange(criterion.citedSpan, transcript)
      : null;
    if (!range) {
      return {
        criterionId: criterion.id,
        label: criterion.label,
        state: 'absent' as const,
        evidence: null,
      };
    }
    const timing = timed ? estimateRangeTiming(timed, range.start, range.end) : null;
    return {
      criterionId: criterion.id,
      label: criterion.label,
      state: criterion.reused ? 'reused' as const : 'found' as const,
      evidence: {
        span: range.span,
        charStart: range.start,
        charEnd: range.end,
        startMs: timing?.startMs ?? null,
        endMs: timing?.endMs ?? null,
      },
    };
  });
}

export interface TranscriptSegment {
  text: string;
  /** Criterion labels this segment evidences; empty for ordinary text. */
  labels: string[];
  /** Earliest estimated time among the citations covering this segment. */
  startMs: number | null;
}

/**
 * Splits the transcript into plain and cited segments so the interface can
 * render the student's exact words with citations marked, as text nodes and
 * never as injected markup (INV-5). Overlapping citations — one span doing two
 * jobs — merge into a single segment carrying both labels, which is the same
 * fact the review screen already flags as a reused citation.
 */
export function segmentTranscript(
  transcript: string,
  entries: readonly RubricTimelineEntry[],
): TranscriptSegment[] {
  const located = entries
    .flatMap((entry) => (entry.evidence
      ? [{
        start: entry.evidence.charStart,
        end: entry.evidence.charEnd,
        label: entry.label,
        startMs: entry.evidence.startMs,
      }]
      : []))
    .filter((range) => range.start >= 0
      && range.end <= transcript.length
      && range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Array<{ start: number; end: number; labels: string[]; startMs: number | null }> = [];
  for (const range of located) {
    const previous = merged[merged.length - 1];
    if (previous && range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end);
      if (!previous.labels.includes(range.label)) previous.labels.push(range.label);
      previous.startMs ??= range.startMs;
      continue;
    }
    merged.push({
      start: range.start,
      end: range.end,
      labels: [range.label],
      startMs: range.startMs,
    });
  }

  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      segments.push({ text: transcript.slice(cursor, range.start), labels: [], startMs: null });
    }
    segments.push({
      text: transcript.slice(range.start, range.end),
      labels: range.labels,
      startMs: range.startMs,
    });
    cursor = range.end;
  }
  if (cursor < transcript.length) {
    segments.push({ text: transcript.slice(cursor), labels: [], startMs: null });
  }
  return segments;
}

/**
 * Criteria whose evidence is estimated to fall after the stated time limit —
 * the part an evaluator who stops at the bell never hears. Untimed evidence is
 * excluded rather than assumed to be late.
 */
export function entriesBeyondLimit(
  entries: readonly RubricTimelineEntry[],
  limitMs: number,
): RubricTimelineEntry[] {
  if (!Number.isFinite(limitMs) || limitMs <= 0) return [];
  return entries.filter((entry) => entry.evidence?.startMs != null
    && entry.evidence.startMs > limitMs);
}

export interface RubricCoverageSummary {
  total: number;
  found: number;
  reused: number;
  absent: number;
  /** Criteria placed on the clock; the rest have offsets but no time. */
  timed: number;
}

export function summarizeRubricCoverage(
  entries: readonly RubricTimelineEntry[],
): RubricCoverageSummary {
  return {
    total: entries.length,
    found: entries.filter((entry) => entry.state === 'found').length,
    reused: entries.filter((entry) => entry.state === 'reused').length,
    absent: entries.filter((entry) => entry.state === 'absent').length,
    timed: entries.filter((entry) => entry.evidence?.startMs != null).length,
  };
}
