import {
  AttemptComparisonSchema,
  RecurringWeaknessSchema,
  SavedSessionSchema,
  type AttemptComparison,
  type ProgressPoint,
  type RehearsalFormat,
  type RecurringWeakness,
  type SavedCriterionResult,
  type SavedSession,
} from './contracts.ts';

export const PRODUCTION_SESSIONS_KEY = 'talkactive.production.sessions.v1';

export function parseSavedSessions(serialized: string | null): SavedSession[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = SavedSessionSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export type ProgressHistoryEntry =
  | {
      source: 'synced';
      id: string;
      createdAt: string;
      evidenceScore: number;
      rehearsalFormat: RehearsalFormat;
      attempt: ProgressPoint;
    }
  | {
      source: 'browser';
      id: string;
      createdAt: string;
      evidenceScore: number;
      rehearsalFormat: RehearsalFormat;
      session: SavedSession;
    };

/**
 * Combines the selected project's durable attempts with its browser summaries.
 *
 * A presentation is written to both places on the happy path, so the server
 * attempt wins an ID collision. An interview currently has no durable attempt
 * row; its unmatched aggregate stays visible as an explicitly browser-only
 * entry instead of disappearing as soon as the SQL request succeeds.
 */
export function mergeProgressHistory(
  syncedAttempts: readonly ProgressPoint[],
  browserSessions: readonly SavedSession[],
): ProgressHistoryEntry[] {
  const byId = new Map<string, ProgressHistoryEntry>();
  for (const session of browserSessions) {
    byId.set(session.id, {
      source: 'browser',
      id: session.id,
      createdAt: session.createdAt,
      evidenceScore: session.evidenceScore,
      rehearsalFormat: session.rehearsalFormat,
      session,
    });
  }
  for (const attempt of syncedAttempts) {
    byId.set(attempt.attemptId, {
      source: 'synced',
      id: attempt.attemptId,
      createdAt: attempt.createdAt,
      evidenceScore: Math.round(attempt.coverage * 100),
      // Durable attempts predate interview persistence and still represent the
      // continuous presentation path. Browser-only interview summaries retain
      // their own format above instead of being folded into this series.
      rehearsalFormat: 'presentation',
      attempt,
    });
  }
  return [...byId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

/**
 * Returns the chronological coverage series compatible with the newest entry.
 *
 * The archive may mix a five-question interview subset with full-rubric
 * presentations. Connecting those percentages would compare different
 * denominators, so the visible line follows one rehearsal format at a time
 * while the complete mixed archive remains available below it.
 */
export function latestCompatibleProgressHistory(
  entries: readonly ProgressHistoryEntry[],
): ProgressHistoryEntry[] {
  const ordered = [...entries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const latestFormat = ordered.at(-1)?.rehearsalFormat;
  return latestFormat
    ? ordered.filter((entry) => entry.rehearsalFormat === latestFormat)
    : [];
}

/** Applies the same latest-format boundary to browser-only progress math. */
export function latestCompatibleSavedSessions(
  sessions: readonly SavedSession[],
): SavedSession[] {
  const ordered = [...sessions].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const latestFormat = ordered.at(-1)?.rehearsalFormat;
  return latestFormat
    ? ordered.filter((session) => session.rehearsalFormat === latestFormat)
    : [];
}

interface ComparableAttempt {
  id: string;
  createdAt: string;
  projectId?: string | null;
  /** Missing on SQL and legacy rows, which are presentation attempts. */
  rehearsalFormat?: RehearsalFormat;
  criteria: SavedCriterionResult[];
}

function compareAdjacentAttempts(
  previous: ComparableAttempt,
  current: ComparableAttempt,
): AttemptComparison {
  const previousByCriterion = new Map(
    previous.criteria.map((criterion) => [criterion.criterionId, criterion]),
  );
  const currentByCriterion = new Map(
    current.criteria.map((criterion) => [criterion.criterionId, criterion]),
  );
  const criterionIds = [...new Set([
    ...previousByCriterion.keys(),
    ...currentByCriterion.keys(),
  ])];
  return AttemptComparisonSchema.parse({
    previousAttemptId: previous.id,
    previousCreatedAt: previous.createdAt,
    currentAttemptId: current.id,
    currentCreatedAt: current.createdAt,
    criteria: criterionIds.map((criterionId) => {
      const previousCriterion = previousByCriterion.get(criterionId) ?? null;
      const currentCriterion = currentByCriterion.get(criterionId) ?? null;
      const coverageDelta = (currentCriterion?.coverage ?? 0) - (previousCriterion?.coverage ?? 0);
      return {
        criterionId,
        criterionName: currentCriterion?.criterionName ?? previousCriterion?.criterionName ?? criterionId,
        previous: previousCriterion,
        current: currentCriterion,
        coverageDelta,
        direction: !previousCriterion
          ? 'added'
          : !currentCriterion
            ? 'removed'
            : coverageDelta > 0 ? 'improved' : coverageDelta < 0 ? 'regressed' : 'unchanged',
      };
    }),
  });
}

export function compareAttemptEvidence(attempts: ComparableAttempt[]): AttemptComparison[] {
  const byCompatibleSeries = new Map<string, ComparableAttempt[]>();
  for (const attempt of attempts.filter((item) => item.criteria.length > 0)) {
    const projectKey = attempt.projectId ?? 'local';
    const rehearsalFormat = attempt.rehearsalFormat ?? 'presentation';
    const seriesKey = JSON.stringify([projectKey, rehearsalFormat]);
    byCompatibleSeries.set(seriesKey, [
      ...(byCompatibleSeries.get(seriesKey) ?? []),
      attempt,
    ]);
  }
  const comparisons: AttemptComparison[] = [];
  for (const projectAttempts of byCompatibleSeries.values()) {
    const detailed = projectAttempts.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    for (let index = 1; index < detailed.length; index += 1) {
      const previous = detailed[index - 1];
      const current = detailed[index];
      if (previous && current) comparisons.push(compareAdjacentAttempts(previous, current));
    }
  }
  return comparisons.sort((left, right) =>
    left.currentCreatedAt.localeCompare(right.currentCreatedAt)
      || left.currentAttemptId.localeCompare(right.currentAttemptId));
}

export function summarizeRecurringWeaknesses(sessions: SavedSession[]): RecurringWeakness[] {
  const observations = new Map<string, {
    criterionId: string;
    criterionName: string;
    values: Array<{
      session: SavedSession;
      coverage: number;
      citedSpan: string | null;
      missingEvidence: string[];
    }>;
  }>();

  for (const session of sessions) {
    for (const criterion of session.criteria) {
      const current = observations.get(criterion.criterionId) ?? {
        criterionId: criterion.criterionId,
        criterionName: criterion.criterionName,
        values: [],
      };
      current.values.push({
        session,
        coverage: criterion.coverage,
        citedSpan: criterion.citedSpan,
        missingEvidence: criterion.missingEvidence,
      });
      observations.set(criterion.criterionId, current);
    }
  }

  const detailedNames = new Set([...observations.values()].map((item) => item.criterionName));
  const detailed = [...observations.values()].flatMap((item) => {
    const gapCount = item.values.filter((value) => value.coverage < 1).length;
    if (gapCount < 2) return [];
    const latest = [...item.values].sort((left, right) =>
      right.session.createdAt.localeCompare(left.session.createdAt))[0];
    if (!latest) return [];
    return [RecurringWeaknessSchema.parse({
      criterionId: item.criterionId,
      criterionName: item.criterionName,
      attemptCount: item.values.length,
      gapCount,
      averageCoverage: item.values.reduce((sum, value) => sum + value.coverage, 0) / item.values.length,
      latestAttemptId: latest.session.id,
      latestAt: latest.session.createdAt,
      latestCitedSpan: latest.citedSpan,
      latestMissingEvidence: latest.missingEvidence,
      summaryOnly: false,
    })];
  });

  // Sessions created before criterion-level retention only know which criterion
  // was weakest. Keep that weaker signal visible, but never fabricate an
  // average, citation, or missing-cue list from it.
  const legacy = new Map<string, SavedSession[]>();
  for (const session of sessions.filter((item) => item.criteria.length === 0)) {
    if (detailedNames.has(session.weakest)) continue;
    legacy.set(session.weakest, [...(legacy.get(session.weakest) ?? []), session]);
  }
  const summaries = [...legacy].flatMap(([criterionName, values]) => {
    if (values.length < 2) return [];
    const latest = [...values].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!latest) return [];
    return [RecurringWeaknessSchema.parse({
      criterionId: `summary:${criterionName}`,
      criterionName,
      attemptCount: values.length,
      gapCount: values.length,
      averageCoverage: null,
      latestAttemptId: null,
      latestAt: latest.createdAt,
      latestCitedSpan: null,
      latestMissingEvidence: [],
      summaryOnly: true,
    })];
  });

  return [...detailed, ...summaries].sort((left, right) => {
    if (left.summaryOnly !== right.summaryOnly) return left.summaryOnly ? 1 : -1;
    const leftCoverage = left.averageCoverage ?? 1;
    const rightCoverage = right.averageCoverage ?? 1;
    return leftCoverage - rightCoverage
      || right.gapCount - left.gapCount
      || left.criterionName.localeCompare(right.criterionName);
  });
}

export interface CriterionTrailPoint {
  readonly attemptId: string;
  readonly at: string;
  readonly coverage: number;
}

export interface CriterionTrail {
  readonly criterionId: string;
  readonly criterionName: string;
  readonly points: readonly CriterionTrailPoint[];
}

/**
 * One coverage series per criterion, rebuilt from the pairwise comparisons.
 *
 * The progress response carries adjacent-attempt comparisons, not per-criterion
 * histories — but each attempt appears twice across the chain (as the `current`
 * of one comparison and the `previous` of the next), so the full series is
 * recoverable without a new query or a new column.
 *
 * This is what lets a recurring gap show its shape. "Differentiation was weak in
 * 3 of 4 attempts" and "Differentiation has been climbing for three attempts"
 * are different pieces of advice, and only the second one tells you to keep
 * doing what you are doing.
 */
export function buildCriterionTrails(
  comparisons: readonly AttemptComparison[],
): CriterionTrail[] {
  const trails = new Map<string, { name: string; points: Map<string, CriterionTrailPoint> }>();

  for (const comparison of comparisons) {
    for (const criterion of comparison.criteria) {
      const entry = trails.get(criterion.criterionId)
        ?? { name: criterion.criterionName, points: new Map<string, CriterionTrailPoint>() };
      // Keyed by attempt so the shared attempt between two consecutive
      // comparisons contributes one point, not two.
      if (criterion.previous) {
        entry.points.set(comparison.previousAttemptId, {
          attemptId: comparison.previousAttemptId,
          at: comparison.previousCreatedAt,
          coverage: criterion.previous.coverage,
        });
      }
      if (criterion.current) {
        entry.points.set(comparison.currentAttemptId, {
          attemptId: comparison.currentAttemptId,
          at: comparison.currentCreatedAt,
          coverage: criterion.current.coverage,
        });
      }
      entry.name = criterion.criterionName;
      trails.set(criterion.criterionId, entry);
    }
  }

  return [...trails].map(([criterionId, entry]) => ({
    criterionId,
    criterionName: entry.name,
    points: [...entry.points.values()].sort((left, right) =>
      left.at.localeCompare(right.at) || left.attemptId.localeCompare(right.attemptId)),
  }));
}
