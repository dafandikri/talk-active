import type { StoredRubricCriterion } from './rubric-storage.ts';
import type { ProjectLanguage } from './contracts.ts';

export const MAX_INTERVIEW_PRIMARY_QUESTIONS = 5;
export const MAX_INTERVIEW_TURNS = MAX_INTERVIEW_PRIMARY_QUESTIONS;

// Interview prompts, narration and dictation all inherit the project locale.
// Keep the old exported name as an alias for callers outside this module, but
// do not maintain a second language union that can drift from the project
// contract.
export type InterviewLanguage = ProjectLanguage;
export type InterviewQuestionKind = 'primary';
export type InterviewVerdict = 'supported' | 'partial' | 'unsupported';
export type InterviewEvidenceEngine = 'semantic' | 'deterministic';

export interface InterviewQuestion {
  readonly id: string;
  readonly criterion: StoredRubricCriterion;
  readonly primaryIndex: number;
  readonly kind: InterviewQuestionKind;
  readonly text: string;
}

export interface InterviewJudgment {
  readonly verdict: InterviewVerdict;
  readonly coverageScore: 0 | 0.5 | 1;
  readonly citedSpan: string | null;
  readonly missingEvidence: readonly string[];
  readonly engine: InterviewEvidenceEngine;
}

export interface InterviewTurnDraft {
  readonly id: string;
  readonly question: InterviewQuestion;
  readonly answer: string;
  readonly durationSeconds: number;
  /** Offsets into the one interview timeline, not separate recording clocks. */
  readonly answerStartMs: number;
  readonly answerEndMs: number;
}

export interface InterviewTurn extends InterviewTurnDraft {
  readonly judgment: InterviewJudgment;
}

export class InterviewSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'InterviewSessionError';
    this.code = code;
  }
}

function evidencePrompt(criterion: StoredRubricCriterion): string {
  const declared = criterion.requiredEvidence.map((item) => item.trim()).filter(Boolean);
  if (declared.length > 0) return declared.slice(0, 4).join(', ');
  return criterion.description.trim() || criterion.name.trim();
}

export function openingInterviewQuestion(
  criterion: StoredRubricCriterion,
  language: InterviewLanguage,
): string {
  const evidence = evidencePrompt(criterion);
  if (language === 'id-ID') {
    return `Bagaimana proyek Anda memenuhi kriteria “${criterion.name}”? Jelaskan secara eksplisit: ${evidence}.`;
  }
  return `How does your project meet “${criterion.name}”? Make this evidence explicit: ${evidence}.`;
}

export function createInterviewPlan(
  criteria: readonly StoredRubricCriterion[],
  language: InterviewLanguage,
  primaryLimit = MAX_INTERVIEW_PRIMARY_QUESTIONS,
): InterviewQuestion[] {
  if (criteria.length === 0) {
    throw new InterviewSessionError('empty_rubric', 'Add at least one rubric criterion before starting the interview.');
  }
  if (!Number.isInteger(primaryLimit) || primaryLimit < 1 || primaryLimit > MAX_INTERVIEW_PRIMARY_QUESTIONS) {
    throw new InterviewSessionError(
      'invalid_primary_limit',
      `Interview question count must be between 1 and ${MAX_INTERVIEW_PRIMARY_QUESTIONS}.`,
    );
  }

  return [...criteria]
    .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id))
    .slice(0, primaryLimit)
    .map((criterion, primaryIndex) => ({
      id: `${criterion.id}:primary`,
      criterion,
      primaryIndex,
      kind: 'primary' as const,
      text: openingInterviewQuestion(criterion, language),
    }));
}

export function validateInterviewJudgment(judgment: InterviewJudgment): InterviewJudgment {
  const citedSpan = judgment.citedSpan?.trim() || null;
  const missingEvidence = [...new Set(
    judgment.missingEvidence.map((item) => item.trim()).filter(Boolean),
  )];

  if (judgment.verdict === 'supported') {
    if (!citedSpan) {
      throw new InterviewSessionError('unsupported_verdict_shape', 'A supported answer must cite an exact answer span.');
    }
    if (missingEvidence.length > 0 || judgment.coverageScore !== 1) {
      throw new InterviewSessionError('unsupported_verdict_shape', 'A supported answer cannot also claim missing evidence.');
    }
  }
  if (judgment.verdict === 'partial') {
    if (!citedSpan || missingEvidence.length === 0 || judgment.coverageScore !== 0.5) {
      throw new InterviewSessionError('unsupported_verdict_shape', 'A partial answer must cite a span and name the remaining evidence.');
    }
  }
  if (judgment.verdict === 'unsupported') {
    if (citedSpan || missingEvidence.length === 0 || judgment.coverageScore !== 0) {
      throw new InterviewSessionError('unsupported_verdict_shape', 'An unsupported answer must name missing evidence without inventing a citation.');
    }
  }

  return { ...judgment, citedSpan, missingEvidence };
}

export function nextInterviewQuestion(
  plan: readonly InterviewQuestion[],
  current: InterviewQuestion,
): InterviewQuestion | null {
  return plan[current.primaryIndex + 1] ?? null;
}

export function validateInterviewTurnDraft(turn: InterviewTurnDraft): InterviewTurnDraft {
  const answer = turn.answer.trim();
  if (!answer) {
    throw new InterviewSessionError('empty_answer', 'Answer this question before continuing.');
  }
  if (
    !Number.isFinite(turn.answerStartMs)
    || !Number.isFinite(turn.answerEndMs)
    || turn.answerStartMs < 0
    || turn.answerEndMs < turn.answerStartMs
  ) {
    throw new InterviewSessionError(
      'invalid_answer_window',
      'An answer window must use ordered offsets from the interview timeline.',
    );
  }
  if (!Number.isFinite(turn.durationSeconds) || turn.durationSeconds <= 0) {
    throw new InterviewSessionError('invalid_answer_duration', 'An answer duration must be positive.');
  }
  return {
    ...turn,
    answer,
    answerStartMs: Math.round(turn.answerStartMs),
    answerEndMs: Math.round(turn.answerEndMs),
    durationSeconds: Math.max(1, Math.round(turn.durationSeconds)),
  };
}

/**
 * The interviewer's words are deliberately excluded. A rubric cue in Kato's
 * question must never become evidence supposedly supplied by the student.
 */
export function aggregateInterviewAnswers(turns: readonly InterviewTurnDraft[]): string {
  return turns.map((turn) => turn.answer.trim()).filter(Boolean).join('\n\n');
}

export function aggregateInterviewDuration(turns: readonly InterviewTurnDraft[]): number {
  return Math.max(1, Math.round(turns.reduce((total, turn) => total + turn.durationSeconds, 0)));
}
