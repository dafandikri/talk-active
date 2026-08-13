/**
 * When a character was spoken, estimated from dictation growth.
 *
 * Browser dictation reports the transcript as it grows, not one timestamp per
 * word. Each snapshot pairs "how much text existed" with "when that arrived",
 * and interpolating between those pairs answers "roughly when was character
 * N spoken".
 *
 * The estimate is deliberately coarse — a second or two. That is enough to
 * place a cited sentence as a block on a lane and to seek a replay to it. It
 * is NOT enough to highlight a single word in sync with the audio, and no
 * caller should present it as if it were. A typed transcript has no
 * relationship to the clock at all, so this module returns null rather than
 * inventing one.
 */

export interface TranscriptTimingPoint {
  /** Length of the recognized transcript when this snapshot was observed. */
  charCount: number;
  /** Milliseconds since capture started. */
  atMs: number;
}

export interface EstimatedRangeTiming {
  startMs: number;
  endMs: number;
}

export class TranscriptTimingTracker {
  private readonly recorded: TranscriptTimingPoint[] = [];

  /**
   * Records one dictation snapshot. Interim recognition rewrites and shortens
   * the tail constantly, so only growth in both axes is kept — otherwise the
   * map stops being monotonic and interpolation reads backwards.
   */
  addSnapshot(transcript: string, atMs: number): void {
    const charCount = transcript.length;
    if (!Number.isFinite(atMs) || charCount === 0) return;
    const boundedAtMs = Math.max(0, atMs);
    const previous = this.recorded[this.recorded.length - 1];
    if (previous && (charCount <= previous.charCount || boundedAtMs <= previous.atMs)) return;
    this.recorded.push({ charCount, atMs: boundedAtMs });
  }

  points(): readonly TranscriptTimingPoint[] {
    return this.recorded;
  }
}

function estimateMsForOffset(
  points: readonly TranscriptTimingPoint[],
  charOffset: number,
): number | null {
  const last = points[points.length - 1];
  if (!last) return null;
  if (charOffset >= last.charCount) return last.atMs;

  let previous: TranscriptTimingPoint = { charCount: 0, atMs: 0 };
  for (const point of points) {
    if (charOffset <= point.charCount) {
      const chars = point.charCount - previous.charCount;
      if (chars <= 0) return point.atMs;
      const progress = (charOffset - previous.charCount) / chars;
      return previous.atMs + progress * (point.atMs - previous.atMs);
    }
    previous = point;
  }
  return last.atMs;
}

/**
 * Estimates when the characters between two offsets were spoken. Returns null
 * when there are no timing points, which is the honest answer for a typed
 * transcript.
 */
export function estimateRangeTiming(
  points: readonly TranscriptTimingPoint[],
  charStart: number,
  charEnd: number,
): EstimatedRangeTiming | null {
  if (points.length === 0) return null;
  if (!Number.isFinite(charStart) || !Number.isFinite(charEnd)) return null;
  const lower = Math.max(0, Math.min(charStart, charEnd));
  const upper = Math.max(0, Math.max(charStart, charEnd));
  const startMs = estimateMsForOffset(points, lower);
  const endMs = estimateMsForOffset(points, upper);
  if (startMs === null || endMs === null) return null;
  return { startMs: Math.round(startMs), endMs: Math.round(Math.max(startMs, endMs)) };
}
