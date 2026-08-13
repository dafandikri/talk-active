import { detectReusedCitations } from './citation-reuse.ts';

export interface WeakestCriterionCandidate {
  criterion: {
    id: string;
    displayOrder: number;
  };
  verdict: {
    criterionId: string;
    coverageScore: number;
    citedSpan: string | null;
    engine: 'semantic' | 'deterministic';
    studentOverridden: boolean;
  };
}

// Coverage ranks the next question only when the evidence reading is stable.
// Deterministic fallbacks, reused citations, and student-rejected readings are
// deliberately ranked as uncertain (0.5): they remain visible, but an
// unreliable zero must not masquerade as the most certain weakness.
export function selectWeakestCriterion<T extends WeakestCriterionCandidate>(
  candidates: T[],
): T | null {
  const reusedCriterionIds = new Set(
    detectReusedCitations(candidates.map(({ verdict }) => ({
      criterionId: verdict.criterionId,
      citedSpan: verdict.citedSpan,
    }))).flatMap((reuse) => reuse.criterionIds),
  );

  return [...candidates].sort((left, right) => {
    const score = (candidate: T) => (
      candidate.verdict.engine === 'deterministic'
      || candidate.verdict.studentOverridden
      || reusedCriterionIds.has(candidate.verdict.criterionId)
        ? 0.5
        : candidate.verdict.coverageScore
    );
    return score(left) - score(right)
      || left.criterion.displayOrder - right.criterion.displayOrder;
  })[0] ?? null;
}
