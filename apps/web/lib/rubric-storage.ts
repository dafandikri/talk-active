import { RubricSourceSchema, type RubricSource } from './contracts.ts';

export const RUBRIC_STORAGE_KEY = 'talkactive.production.rubric.v1';
export const RUBRIC_SOURCE_STORAGE_KEY = 'talkactive.production.rubric-source.v1';

export function readRubricSourceType(storage: Pick<Storage, 'getItem'>): RubricSource {
  const parsed = RubricSourceSchema.safeParse(storage.getItem(RUBRIC_SOURCE_STORAGE_KEY));
  return parsed.success ? parsed.data : 'manual';
}
