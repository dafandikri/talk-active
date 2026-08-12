import { z } from 'zod';

import { RubricSourceSchema, type RubricSource } from './contracts.ts';

export const RUBRIC_STORAGE_KEY = 'talkactive.production.rubric.v2';
export const LEGACY_RUBRIC_STORAGE_KEY = 'talkactive.production.rubric.v1';
export const RUBRIC_SOURCE_STORAGE_KEY = 'talkactive.production.rubric-source.v1';

export const StoredRubricCriterionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  requiredEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  sourceExcerpt: z.string().trim().min(1).max(2_000).nullable(),
  displayOrder: z.number().int().nonnegative(),
});

const StoredRubricDocumentSchema = z.object({
  version: z.literal(2),
  criteria: z.array(StoredRubricCriterionSchema).min(1).max(20),
}).superRefine((value, context) => {
  const ids = new Set(value.criteria.map((criterion) => criterion.id));
  if (ids.size !== value.criteria.length) {
    context.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion ids must be unique.' });
  }
  const orders = new Set(value.criteria.map((criterion) => criterion.displayOrder));
  if (orders.size !== value.criteria.length) {
    context.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion order must be unique.' });
  }
});

const LegacyCriterionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  evidence: z.string().trim().min(1).max(8_000),
  sourceExcerpt: z.string().trim().min(1).max(2_000).nullable().optional(),
});

export type StoredRubricCriterion = z.infer<typeof StoredRubricCriterionSchema>;

export function parseEvidencePhrases(value: string): string[] {
  return [...new Set(value
    .split(/[,;\n]/u)
    .map((phrase) => phrase.trim())
    .filter(Boolean))].slice(0, 40);
}

export function rubricTextFromCriteria(criteria: StoredRubricCriterion[]): string {
  return [...criteria]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((criterion) => {
      const fallbackEvidence = criterion.description.trim() || criterion.name;
      const evidence = criterion.requiredEvidence.length > 0
        ? criterion.requiredEvidence.join(', ')
        : fallbackEvidence;
      return `${criterion.name} | ${evidence}`;
    })
    .join('\n');
}

export function readStoredRubricCriteria(
  storage: Pick<Storage, 'getItem'>,
): StoredRubricCriterion[] | null {
  try {
    const current = storage.getItem(RUBRIC_STORAGE_KEY);
    if (current) {
      const parsed = StoredRubricDocumentSchema.safeParse(JSON.parse(current));
      if (parsed.success) {
        return [...parsed.data.criteria].sort(
          (left, right) => left.displayOrder - right.displayOrder,
        );
      }
    }

    const legacy = storage.getItem(LEGACY_RUBRIC_STORAGE_KEY);
    if (!legacy) return null;
    const parsedLegacy = z.array(LegacyCriterionSchema).min(1).max(20).safeParse(JSON.parse(legacy));
    if (!parsedLegacy.success) return null;
    return parsedLegacy.data.map((criterion, displayOrder) => ({
      id: criterion.id,
      name: criterion.name,
      description: '',
      requiredEvidence: parseEvidencePhrases(criterion.evidence),
      sourceExcerpt: criterion.sourceExcerpt ?? null,
      displayOrder,
    }));
  } catch {
    return null;
  }
}

export function writeStoredRubricCriteria(
  storage: Pick<Storage, 'setItem'>,
  criteria: StoredRubricCriterion[],
): StoredRubricCriterion[] {
  const ordered = criteria.map((criterion, displayOrder) => ({ ...criterion, displayOrder }));
  const document = StoredRubricDocumentSchema.parse({ version: 2, criteria: ordered });
  storage.setItem(RUBRIC_STORAGE_KEY, JSON.stringify(document));
  return document.criteria;
}

export function readRubricSourceType(storage: Pick<Storage, 'getItem'>): RubricSource {
  const parsed = RubricSourceSchema.safeParse(storage.getItem(RUBRIC_SOURCE_STORAGE_KEY));
  return parsed.success ? parsed.data : 'manual';
}
