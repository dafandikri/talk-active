import { normaliseForGrounding } from './grounding.ts';

export interface CitedCriterion {
  criterionId: string;
  citedSpan: string | null;
}

export interface ReusedCitation {
  citedSpan: string;
  criterionIds: string[];
}

export function detectReusedCitations(results: CitedCriterion[]): ReusedCitation[] {
  const groups = new Map<string, ReusedCitation>();

  for (const result of results) {
    if (!result.citedSpan?.trim()) continue;
    const key = normaliseForGrounding(result.citedSpan);
    if (!key) continue;

    const group = groups.get(key) ?? {
      citedSpan: result.citedSpan,
      criterionIds: [],
    };
    if (!group.criterionIds.includes(result.criterionId)) {
      group.criterionIds.push(result.criterionId);
    }
    groups.set(key, group);
  }

  return [...groups.values()].filter((group) => group.criterionIds.length > 1);
}
