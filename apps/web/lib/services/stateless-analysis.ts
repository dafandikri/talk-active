import {
  analyzeSpeech,
  makeDrill,
  parseRubric,
} from '../analyzer.ts';
import {
  judgeEvidence,
  type EvidenceJudgment,
  type EvidenceJudgeOptions,
} from '../ai/evidence-judge.ts';
import {
  generateJudgeQuestion,
  type QuestionDraft,
  type QuestionGeneratorOptions,
} from '../ai/question-generator.ts';
import { detectReusedCitations } from '../citation-reuse.ts';
import {
  CONTRACT_VERSION,
  StatelessAnalysisResponseSchema,
  type Criterion,
  type StatelessAnalysisRequest,
  type StatelessAnalysisResponse,
} from '../contracts.ts';
import { selectWeakestCriterion } from '../weakest-criterion.ts';

type JudgeEvidence = (
  transcript: string,
  criteria: Criterion[],
  options?: EvidenceJudgeOptions,
) => Promise<EvidenceJudgment[]>;

type GenerateQuestion = (
  transcript: string,
  criterion: Criterion,
  judgment: EvidenceJudgment,
  options?: QuestionGeneratorOptions,
) => Promise<QuestionDraft>;

export interface StatelessAnalysisOptions {
  judge?: JudgeEvidence;
  question?: GenerateQuestion;
  evidenceOptions?: EvidenceJudgeOptions;
  questionOptions?: QuestionGeneratorOptions;
}

function contractCriteria(input: StatelessAnalysisRequest): Criterion[] {
  return parseRubric(input.rubricText).map((criterion, displayOrder) => ({
    id: criterion.id,
    rubricId: 'stateless-analysis',
    name: criterion.label,
    description: criterion.requirementText,
    requiredEvidence: criterion.signals,
    displayOrder,
  }));
}

async function evidenceWithFallback(
  input: StatelessAnalysisRequest,
  criteria: Criterion[],
  options: StatelessAnalysisOptions,
): Promise<EvidenceJudgment[]> {
  try {
    return await (options.judge ?? judgeEvidence)(
      input.transcript,
      criteria,
      options.evidenceOptions,
    );
  } catch {
    return judgeEvidence(input.transcript, criteria, { model: '' });
  }
}

async function questionWithFallback(
  input: StatelessAnalysisRequest,
  criterion: Criterion,
  judgment: EvidenceJudgment,
  options: StatelessAnalysisOptions,
): Promise<QuestionDraft> {
  try {
    return await (options.question ?? generateJudgeQuestion)(
      input.transcript,
      criterion,
      judgment,
      options.questionOptions,
    );
  } catch {
    return generateJudgeQuestion(input.transcript, criterion, judgment, { model: '' });
  }
}

export async function analyzeStatelessAttempt(
  input: StatelessAnalysisRequest,
  options: StatelessAnalysisOptions = {},
): Promise<StatelessAnalysisResponse> {
  const local = analyzeSpeech({
    transcript: input.transcript,
    rubricText: input.rubricText,
    durationSeconds: input.durationSeconds,
  });
  const criteria = contractCriteria(input);
  const judgments = await evidenceWithFallback(input, criteria, options);
  const byCriterion = new Map(judgments.map((judgment) => [judgment.criterionId, judgment]));

  const candidates = criteria.map((criterion) => {
    const verdict = byCriterion.get(criterion.id);
    if (!verdict) throw new Error(`Evidence analysis omitted criterion ${criterion.id}.`);
    return {
      criterion,
      verdict: { ...verdict, studentOverridden: false },
    };
  });
  const selected = selectWeakestCriterion(candidates);
  if (!selected) throw new Error('Evidence analysis returned no weakest criterion.');
  const question = await questionWithFallback(
    input,
    selected.criterion,
    selected.verdict,
    options,
  );

  const mappedCriteria = criteria.map((criterion, index) => {
    const judgment = byCriterion.get(criterion.id);
    const localCriterion = local.criteria[index];
    if (!judgment || !localCriterion) {
      throw new Error(`Evidence analysis could not map criterion ${criterion.id}.`);
    }
    return {
      id: criterion.id,
      label: criterion.name,
      requirementText: criterion.description,
      signals: criterion.requiredEvidence,
      score: judgment.coverageScore * 100,
      status: judgment.verdict === 'supported'
        ? 'covered' as const
        : judgment.verdict === 'partial' ? 'partial' as const : 'missing' as const,
      matchedSignals: localCriterion.matchedSignals,
      missingSignals: judgment.missingEvidence,
      excerpt: judgment.citedSpan ?? '',
    };
  });
  const weakest = mappedCriteria.find((criterion) => criterion.id === selected.criterion.id);
  if (!weakest) throw new Error('The selected weakest criterion was not returned.');

  const semanticEvidenceCount = judgments.filter((judgment) => judgment.engine === 'semantic').length;
  const semanticUnitCount = semanticEvidenceCount + (question.engine === 'semantic' ? 1 : 0);
  const unitCount = judgments.length + 1;
  const mode = semanticUnitCount === unitCount
    ? 'semantic' as const
    : semanticUnitCount === 0 ? 'deterministic' as const : 'mixed' as const;

  return StatelessAnalysisResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    analysis: {
      ...local,
      evidenceScore: Math.round(
        mappedCriteria.reduce((sum, criterion) => sum + criterion.score, 0)
        / mappedCriteria.length,
      ),
      coveredCount: mappedCriteria.filter((criterion) => criterion.status === 'covered').length,
      criterionCount: mappedCriteria.length,
      criteria: mappedCriteria,
      weakest,
      judgeQuestion: question.questionText,
      drill: makeDrill(weakest),
    },
    mode,
    criterionEngines: judgments.map((judgment) => ({
      criterionId: judgment.criterionId,
      engine: judgment.engine,
    })),
    reusedCitations: detectReusedCitations(judgments),
    questionEngine: question.engine,
    cached: false,
  });
}
