import { z } from 'zod';

import {
  analyzeSpeech,
  type EvidenceCriterion,
} from './analyzer.ts';
import { normaliseForGrounding } from './grounding.ts';

export const LOCAL_EVIDENCE_CONFIRMATIONS_KEY = 'talkactive.production.evidence-confirmations.v1';

export const LocalEvidenceConfirmationSchema = z.object({
  id: z.string().trim().min(1).max(128),
  reviewId: z.string().trim().min(1).max(128),
  criterionId: z.string().trim().min(1).max(128),
  criterionName: z.string().trim().min(1).max(200),
  accepted: z.boolean(),
  judgedVerdict: z.enum(['supported', 'partial', 'unsupported']),
  judgedCoverageScore: z.union([z.literal(0), z.literal(0.5), z.literal(1)]),
  judgedCitedSpan: z.string().max(12_000).nullable(),
  judgedMissingEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  judgedEngine: z.enum(['semantic', 'deterministic']),
  createdAt: z.string().datetime({ offset: true }),
  rejudgedAt: z.string().datetime({ offset: true }).nullable(),
});

export type LocalEvidenceConfirmation = z.infer<typeof LocalEvidenceConfirmationSchema>;

export function parseLocalEvidenceConfirmations(serialized: string | null): LocalEvidenceConfirmation[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = LocalEvidenceConfirmationSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export function appendLocalEvidenceConfirmation(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  confirmation: LocalEvidenceConfirmation,
): void {
  const existing = parseLocalEvidenceConfirmations(storage.getItem(LOCAL_EVIDENCE_CONFIRMATIONS_KEY));
  if (existing.some((item) => item.reviewId === confirmation.reviewId
    && item.criterionId === confirmation.criterionId)) return;
  storage.setItem(
    LOCAL_EVIDENCE_CONFIRMATIONS_KEY,
    JSON.stringify([...existing, LocalEvidenceConfirmationSchema.parse(confirmation)].slice(-500)),
  );
}

function sentenceWithoutRejectedEvidence(transcript: string, rejectedSpan: string): string {
  const rejected = normaliseForGrounding(rejectedSpan);
  if (!rejected) return transcript;
  return transcript
    .split(/(?<=[.!?])\s+|\r?\n+/u)
    .filter((sentence) => !normaliseForGrounding(sentence).includes(rejected))
    .join(' ')
    .trim();
}

export function rejudgeLocalEvidence(
  transcript: string,
  criterion: EvidenceCriterion,
  durationSeconds: number,
): { criterion: EvidenceCriterion; judgeQuestion: string; drill: string } {
  const reducedTranscript = sentenceWithoutRejectedEvidence(transcript, criterion.excerpt);
  if (!reducedTranscript) {
    return {
      criterion: {
        ...criterion,
        score: 0,
        status: 'missing',
        matchedSignals: [],
        missingSignals: criterion.signals.length > 0 ? criterion.signals : [criterion.requirementText],
        excerpt: '',
      },
      judgeQuestion: `What explicit evidence would satisfy ${criterion.label}?`,
      drill: `Add one concrete, evaluator-checkable statement for ${criterion.label}.`,
    };
  }

  const rerun = analyzeSpeech({
    transcript: reducedTranscript,
    rubricText: `${criterion.label} | ${criterion.signals.join(', ') || criterion.requirementText}`,
    durationSeconds,
  });
  const next = rerun.criteria[0];
  if (!next) throw new Error('The local re-judge returned no criterion.');
  return { criterion: next, judgeQuestion: rerun.judgeQuestion, drill: rerun.drill };
}
