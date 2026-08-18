import {
  judgeCriterion,
  type EvidenceJudgment,
  type EvidenceJudgeOptions,
} from '../ai/evidence-judge.ts';
import {
  generateJudgeQuestion,
  type QuestionDraft,
  type QuestionGeneratorOptions,
} from '../ai/question-generator.ts';
import {
  CONTRACT_VERSION,
  InterviewAnalysisRequestSchema,
  InterviewAnalysisResponseSchema,
  type Criterion,
  type InterviewAnalysisRequest,
  type InterviewAnalysisResponse,
  type InterviewAnalysisTurn,
  type ProjectLanguage,
} from '../contracts.ts';
import { findGroundedSpan, normaliseForGrounding } from '../grounding.ts';
import { selectWeakestCriterion } from '../weakest-criterion.ts';

type JudgeInterviewTurn = (
  answer: string,
  criterion: Criterion,
  options?: EvidenceJudgeOptions,
) => Promise<EvidenceJudgment>;

type GenerateHardestQuestion = (
  answer: string,
  criterion: Criterion,
  judgment: EvidenceJudgment,
  options?: QuestionGeneratorOptions,
) => Promise<QuestionDraft>;

export interface InterviewAnalysisOptions {
  judge?: JudgeInterviewTurn;
  question?: GenerateHardestQuestion;
  evidenceOptions?: EvidenceJudgeOptions;
  questionOptions?: QuestionGeneratorOptions;
}

interface EvaluatedTurn {
  turn: InterviewAnalysisTurn;
  judgment: EvidenceJudgment;
}

function verdictScore(verdict: EvidenceJudgment['verdict']): 0 | 0.5 | 1 {
  return verdict === 'supported' ? 1 : verdict === 'partial' ? 0.5 : 0;
}

function groundedJudgment(
  turn: InterviewAnalysisTurn,
  judgment: EvidenceJudgment,
): EvidenceJudgment | null {
  if (
    judgment.criterionId !== turn.criterion.id
    || judgment.coverageScore !== verdictScore(judgment.verdict)
  ) return null;

  if (judgment.verdict === 'unsupported') {
    return judgment.citedSpan === null && judgment.missingEvidence.length > 0
      ? judgment
      : null;
  }

  if (
    !judgment.citedSpan
    || (judgment.verdict === 'partial' && judgment.missingEvidence.length === 0)
    || (judgment.verdict === 'supported' && judgment.missingEvidence.length > 0)
  ) return null;
  const exactAnswerSpan = findGroundedSpan(judgment.citedSpan, turn.answer);
  return exactAnswerSpan ? { ...judgment, citedSpan: exactAnswerSpan } : null;
}

async function judgeWithFallback(
  turn: InterviewAnalysisTurn,
  options: InterviewAnalysisOptions,
  language: ProjectLanguage,
): Promise<EvidenceJudgment> {
  try {
    const judgment = await (options.judge ?? judgeCriterion)(
      turn.answer,
      turn.criterion,
      { ...options.evidenceOptions, language },
    );
    const grounded = groundedJudgment(turn, judgment);
    if (grounded) return grounded;
  } catch {
    // A provider or injected semantic unit failed. The same answer-local
    // deterministic path below remains available without another network call.
  }
  return judgeCriterion(turn.answer, turn.criterion, {
    ...options.evidenceOptions,
    model: '',
    language,
  });
}

function groundedQuestion(
  draft: QuestionDraft,
  selected: EvaluatedTurn,
): QuestionDraft | null {
  if (draft.sourceDocumentId !== null || draft.basis === 'source-document') return null;
  if (draft.basis === 'transcript') {
    const exactAnswerSpan = findGroundedSpan(draft.challengedClaim, selected.turn.answer);
    return exactAnswerSpan ? { ...draft, challengedClaim: exactAnswerSpan } : null;
  }
  const target = normaliseForGrounding(draft.challengedClaim);
  return selected.judgment.missingEvidence.some(
    (item) => normaliseForGrounding(item) === target,
  ) ? draft : null;
}

async function questionWithFallback(
  selected: EvaluatedTurn,
  options: InterviewAnalysisOptions,
  language: ProjectLanguage,
): Promise<QuestionDraft> {
  try {
    const draft = await (options.question ?? generateJudgeQuestion)(
      selected.turn.answer,
      selected.turn.criterion,
      selected.judgment,
      { ...options.questionOptions, language },
    );
    const grounded = groundedQuestion(draft, selected);
    if (grounded) return grounded;
  } catch {
    // The deterministic question below is derived only from the accepted
    // answer-local verdict, so a question-model failure cannot end the review.
  }
  return generateJudgeQuestion(
    selected.turn.answer,
    selected.turn.criterion,
    selected.judgment,
    { ...options.questionOptions, model: '', language },
  );
}

/**
 * Analyze a completed fixed interview without ever concatenating its answers.
 * Each evidence unit receives exactly one answer and its paired criterion;
 * the fixed question prose is not part of this request type.
 */
export async function analyzeInterview(
  input: InterviewAnalysisRequest,
  options: InterviewAnalysisOptions = {},
): Promise<InterviewAnalysisResponse> {
  const parsed = InterviewAnalysisRequestSchema.parse(input);
  const evaluated = await Promise.all(parsed.turns.map(async (turn) => ({
    turn,
    judgment: await judgeWithFallback(turn, options, parsed.language),
  })));

  const selected = selectWeakestCriterion(evaluated.map((item) => ({
    ...item,
    criterion: item.turn.criterion,
    verdict: { ...item.judgment, studentOverridden: false },
  })));
  if (!selected) throw new Error('Interview analysis returned no question target.');
  const question = await questionWithFallback(selected, options, parsed.language);
  const unitEngines = [
    ...evaluated.map((item) => item.judgment.engine),
    question.engine,
  ];
  const mode = unitEngines.every((engine) => engine === 'semantic')
    ? 'semantic' as const
    : unitEngines.every((engine) => engine === 'deterministic')
      ? 'deterministic' as const
      : 'mixed' as const;

  return InterviewAnalysisResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    turns: evaluated.map(({ turn, judgment }) => ({
      turnId: turn.turnId,
      criterionId: turn.criterion.id,
      judgment: {
        verdict: judgment.verdict,
        coverageScore: judgment.coverageScore,
        citedSpan: judgment.citedSpan,
        missingEvidence: judgment.missingEvidence,
        engine: judgment.engine,
        degradedReason: judgment.degradedReason,
      },
    })),
    hardestQuestion: {
      criterionId: selected.turn.criterion.id,
      questionText: question.questionText,
      engine: question.engine,
    },
    mode,
  });
}
