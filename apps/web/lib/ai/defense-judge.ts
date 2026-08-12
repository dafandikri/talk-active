import type { Criterion } from '../contracts.ts';
import {
  judgeCriterion,
  type EvidenceJudgeOptions,
  type EvidenceJudgment,
} from './evidence-judge.ts';

export interface DefenseJudgment extends EvidenceJudgment {
  stage: 'defense';
}

export async function judgeDefense(
  answer: string,
  criterion: Criterion,
  options: EvidenceJudgeOptions = {},
): Promise<DefenseJudgment> {
  const normalizedAnswer = answer.trim();
  if (!normalizedAnswer) throw new Error('Answer the judge before evaluating your defense.');
  if (normalizedAnswer.length > 12_000) throw new Error('Keep the defense answer under 12000 characters.');

  // The answer becomes the only transcript EvidenceJudge sees. The original
  // rehearsal is deliberately absent, so a strong pitch cannot rescue a weak
  // defense answer.
  const judgment = await judgeCriterion(normalizedAnswer, criterion, {
    ...options,
    model: options.model ?? process.env.AI_DEFENSE_MODEL?.trim()
      ?? process.env.AI_EVIDENCE_MODEL?.trim()
      ?? '',
  });
  return { ...judgment, stage: 'defense' };
}
