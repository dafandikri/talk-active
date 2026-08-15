import { judgeDefense } from '../ai/defense-judge.ts';
import {
  rejudgeCriterionAfterRejection,
  type EvidenceJudgeOptions,
  type EvidenceJudgment,
} from '../ai/evidence-judge.ts';
import {
  generateJudgeQuestion,
  type QuestionGeneratorOptions,
} from '../ai/question-generator.ts';
import {
  CONTRACT_VERSION,
  StatelessDefenseResponseSchema,
  StatelessRejudgeResponseSchema,
  type StatelessDefenseRequest,
  type StatelessDefenseResponse,
  type StatelessRejudgeRequest,
  type StatelessRejudgeResponse,
} from '../contracts.ts';

interface StatelessRejudgeOptions {
  evidence?: EvidenceJudgeOptions;
  question?: QuestionGeneratorOptions;
}

function exposedJudgment(judgment: EvidenceJudgment) {
  return {
    criterionId: judgment.criterionId,
    verdict: judgment.verdict,
    coverageScore: judgment.coverageScore,
    citedSpan: judgment.citedSpan,
    missingEvidence: judgment.missingEvidence,
    engine: judgment.engine,
    degradedReason: judgment.degradedReason,
  };
}

export async function rejudgeStatelessEvidence(
  input: StatelessRejudgeRequest,
  options: StatelessRejudgeOptions = {},
): Promise<StatelessRejudgeResponse> {
  const judgment = await rejudgeCriterionAfterRejection(
    input.transcript,
    input.criterion,
    input.rejected,
    options.evidence,
  );
  const question = await generateJudgeQuestion(
    input.transcript,
    input.criterion,
    judgment,
    { ...options.question, language: input.language },
  );
  const semanticUnits = Number(judgment.engine === 'semantic')
    + Number(question.engine === 'semantic');

  return StatelessRejudgeResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    judgment: exposedJudgment(judgment),
    questionTargetCriterionId: input.criterion.id,
    questionText: question.questionText,
    questionEngine: question.engine,
    mode: semanticUnits === 2 ? 'semantic' : semanticUnits === 0 ? 'deterministic' : 'mixed',
  });
}

export async function evaluateStatelessDefense(
  input: StatelessDefenseRequest,
  options: EvidenceJudgeOptions = {},
): Promise<StatelessDefenseResponse> {
  const judgment = await judgeDefense(input.answerText, input.criterion, options);
  return StatelessDefenseResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    judgment: exposedJudgment(judgment),
  });
}
