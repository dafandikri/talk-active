import {
  AnalysisError,
  MAX_TRANSCRIPT_CHARS,
  makeDrill,
  makeJudgeQuestion,
  type AnalysisResult,
} from '../analyzer.ts';
import type { ProjectLanguage } from '../contracts.ts';

export interface CriterionRejudgment {
  verdict: 'supported' | 'partial' | 'unsupported';
  coverageScore: 0 | 0.5 | 1;
  citedSpan: string | null;
  missingEvidence: string[];
  engine: 'semantic' | 'deterministic';
}

interface RejudgmentQuestion {
  text?: string;
  drillText?: string;
  targetCriterionId?: string;
}

export interface MergedCriterionRejudgment {
  analysis: AnalysisResult;
  questionRefresh: 'response' | 'deterministic' | 'unchanged';
}

/**
 * Keeps additions visibly separate from the original take and enforces the
 * same wire-contract limit before any client state or capture evidence is
 * invalidated. The marker follows the project language because it becomes
 * durable transcript context; the student's original words are untouched.
 */
export function buildMarkedRetakeTranscript(
  transcript: string,
  criterionLabel: string,
  addition: string,
  language: ProjectLanguage = 'id-ID',
): string {
  const marker = language === 'id-ID' ? 'Tambahan' : 'Addition';
  const marked = `${transcript.trim()}\n\n[${marker} · ${criterionLabel}] ${addition.trim()}`;
  if (marked.length > MAX_TRANSCRIPT_CHARS) {
    throw new AnalysisError(
      'transcript_too_long',
      `That addition would take the transcript past the ${MAX_TRANSCRIPT_CHARS}-character limit.`,
    );
  }
  return marked;
}

/**
 * Replaces one criterion reading without letting its former judge question
 * survive after another criterion becomes the weakest. The API can return a
 * question only for the criterion it re-judged, so a newly weakest neighbour
 * is refreshed locally and disclosed as deterministic by the caller.
 */
export function mergeCriterionRejudgment(
  analysis: AnalysisResult,
  criterionId: string,
  next: CriterionRejudgment,
  language: ProjectLanguage,
  question: RejudgmentQuestion = {},
): MergedCriterionRejudgment {
  if (!analysis.criteria.some((criterion) => criterion.id === criterionId)) {
    throw new AnalysisError(
      'unknown_retake_criterion',
      'That criterion is no longer part of this review.',
    );
  }

  const criteria = analysis.criteria.map((criterion) => criterion.id === criterionId
    ? {
        ...criterion,
        score: next.coverageScore * 100,
        status: next.verdict === 'supported'
          ? 'covered' as const
          : next.verdict === 'partial' ? 'partial' as const : 'missing' as const,
        missingSignals: [...next.missingEvidence],
        excerpt: next.citedSpan ?? '',
      }
    : criterion);
  const weakest = [...criteria].sort((left, right) => left.score - right.score)[0];
  if (!weakest) {
    throw new AnalysisError('empty_rubric', 'Add at least one rubric criterion.');
  }

  const returnedQuestion = question.text;
  const responseTargetsWeakest = returnedQuestion !== undefined
    && question.targetCriterionId === weakest.id;
  const affectedWeakest = analysis.weakest.id !== weakest.id || weakest.id === criterionId;
  const questionRefresh = responseTargetsWeakest
    ? 'response' as const
    : affectedWeakest ? 'deterministic' as const : 'unchanged' as const;
  const judgeQuestion = responseTargetsWeakest && returnedQuestion !== undefined
    ? returnedQuestion
    : affectedWeakest ? makeJudgeQuestion(weakest, language) : analysis.judgeQuestion;
  const drill = responseTargetsWeakest
    ? question.drillText ?? makeDrill(weakest, language)
    : affectedWeakest ? makeDrill(weakest, language) : analysis.drill;

  return {
    analysis: {
      ...analysis,
      evidenceScore: Math.round(
        criteria.reduce((sum, criterion) => sum + criterion.score, 0) / criteria.length,
      ),
      coveredCount: criteria.filter((criterion) => criterion.status === 'covered').length,
      criteria,
      weakest,
      judgeQuestion,
      drill,
    },
    questionRefresh,
  };
}
