import { z } from 'zod';

// One file is the runtime boundary and the TypeScript boundary. Route handlers
// parse with these schemas; components consume the inferred types. A parallel
// interface declaration is a contract drift bug.
// v2 replaces the stateless analysis boundary's flattened `rubricText` with
// ordered, typed criteria. Keep this version explicit so an older client
// cannot accidentally send the v1 shape and receive a plausible wrong review.
export const CONTRACT_VERSION = 2 as const;

const IdSchema = z.string().trim().min(1).max(128);
const TimestampSchema = z.string().datetime({ offset: true });
const OptionalTimestampSchema = TimestampSchema.nullable();

export const ProjectSchema = z.object({
  id: IdSchema,
  userId: IdSchema.nullable(),
  title: z.string().trim().min(1).max(160),
  eventContext: z.string().trim().max(500).nullable(),
  deadline: z.string().date().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const RubricSourceSchema = z.enum(['manual', 'imported', 'library']);

export const RubricSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sourceType: RubricSourceSchema,
  confirmedAt: OptionalTimestampSchema,
  createdAt: TimestampSchema,
});

export const CriterionSchema = z.object({
  id: IdSchema,
  rubricId: IdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  requiredEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  displayOrder: z.number().int().nonnegative(),
});

export const AttemptModeSchema = z.enum(['typed', 'dictated']);
export const AttemptStatusSchema = z.enum([
  'draft',
  'analysing',
  'review',
  'defending',
  'complete',
  'failed',
]);
export const TranscriptSourceSchema = z.enum(['typed', 'web-speech', 'imported']);

export const AttemptSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  mode: AttemptModeSchema,
  status: AttemptStatusSchema,
  transcript: z.string().max(12_000),
  transcriptSource: TranscriptSourceSchema,
  durationSeconds: z.number().finite().positive().max(3_600),
  legacyTitle: z.string().trim().min(1).max(200).nullable().optional(),
  legacyEvidenceCoverage: z.number().min(0).max(100).nullable().optional(),
  legacyWeakest: z.string().trim().min(1).max(200).nullable().optional(),
  legacyDefenseStatus: z.enum(['defensible', 'developing', 'vulnerable']).nullable().optional(),
  createdAt: TimestampSchema,
  completedAt: OptionalTimestampSchema,
});

export const EvidenceStageSchema = z.enum(['initial', 'defense']);
export const EvidenceVerdictValueSchema = z.enum(['supported', 'partial', 'unsupported']);
export const CoverageScoreSchema = z.union([z.literal(0), z.literal(0.5), z.literal(1)]);
export const EvidenceEngineSchema = z.enum(['semantic', 'deterministic']);

export const EvidenceVerdictSchema = z.object({
  id: IdSchema,
  attemptId: IdSchema,
  criterionId: IdSchema,
  stage: EvidenceStageSchema,
  verdict: EvidenceVerdictValueSchema,
  coverageScore: CoverageScoreSchema,
  citedSpan: z.string().max(12_000).nullable(),
  missingEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  engine: EvidenceEngineSchema,
  verifierAgreed: z.boolean().nullable(),
  verifierNote: z.string().max(2_000).nullable(),
  studentOverridden: z.boolean(),
  studentOverrideVerdict: EvidenceVerdictValueSchema.nullable(),
  createdAt: TimestampSchema,
}).superRefine((value, context) => {
  if (value.verdict !== 'unsupported' && !value.citedSpan?.trim()) {
    context.addIssue({
      code: 'custom',
      path: ['citedSpan'],
      message: 'A supported or partial verdict must cite a transcript span.',
    });
  }
  if (value.verdict === 'unsupported' && value.citedSpan !== null) {
    context.addIssue({
      code: 'custom',
      path: ['citedSpan'],
      message: 'An unsupported verdict cannot retain a supporting citation.',
    });
  }
  if (value.verdict !== 'supported' && value.missingEvidence.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingEvidence'],
      message: 'A partial or unsupported verdict must name the evidence that is missing.',
    });
  }
  if (value.verdict === 'supported' && value.missingEvidence.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingEvidence'],
      message: 'A supported verdict cannot also claim that evidence is missing.',
    });
  }
  if (value.studentOverridden !== (value.studentOverrideVerdict !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['studentOverrideVerdict'],
      message: 'An override value is required if and only if the verdict was overridden.',
    });
  }
});

export const EvidenceConfirmationSchema = z.object({
  id: IdSchema,
  evidenceVerdictId: IdSchema,
  accepted: z.boolean(),
  judgedVerdict: EvidenceVerdictValueSchema,
  judgedCoverageScore: CoverageScoreSchema,
  judgedCitedSpan: z.string().max(12_000).nullable(),
  judgedMissingEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  judgedEngine: EvidenceEngineSchema,
  createdAt: TimestampSchema,
  rejudgedAt: OptionalTimestampSchema,
}).superRefine((value, context) => {
  if (value.judgedVerdict !== 'unsupported' && !value.judgedCitedSpan?.trim()) {
    context.addIssue({
      code: 'custom',
      path: ['judgedCitedSpan'],
      message: 'A supported or partial evaluation label must retain the cited span it judged.',
    });
  }
  if (value.judgedVerdict === 'unsupported' && value.judgedCitedSpan !== null) {
    context.addIssue({
      code: 'custom',
      path: ['judgedCitedSpan'],
      message: 'An unsupported evaluation label cannot retain a supporting citation.',
    });
  }
  if (value.judgedVerdict !== 'supported' && value.judgedMissingEvidence.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['judgedMissingEvidence'],
      message: 'A partial or unsupported evaluation label must retain the missing evidence it judged.',
    });
  }
  if (value.judgedVerdict === 'supported' && value.judgedMissingEvidence.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['judgedMissingEvidence'],
      message: 'A supported evaluation label cannot retain missing evidence.',
    });
  }
  if (value.accepted && value.rejudgedAt !== null) {
    context.addIssue({
      code: 'custom',
      path: ['rejudgedAt'],
      message: 'An accepted verdict must not trigger a re-judge.',
    });
  }
});

export const QuestionBasisSchema = z.enum([
  'transcript',
  'missing-evidence',
  'source-document',
  'legacy-unknown',
]);

export const QuestionSchema = z.object({
  id: IdSchema,
  attemptId: IdSchema,
  targetCriterionId: IdSchema,
  questionText: z.string().trim().min(1).max(2_000),
  challengedClaim: z.string().trim().min(1).max(2_000),
  basis: QuestionBasisSchema,
  sourceDocumentId: IdSchema.nullable(),
  createdAt: TimestampSchema,
}).superRefine((value, context) => {
  if ((value.basis === 'source-document') !== (value.sourceDocumentId !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['sourceDocumentId'],
      message: 'A source document is required if and only if the question is grounded in one.',
    });
  }
});

export const DefenseAnswerSchema = z.object({
  id: IdSchema,
  questionId: IdSchema,
  answerText: z.string().trim().min(1).max(12_000),
  createdAt: TimestampSchema,
});

export const SourceDocumentSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  blobUrl: z.url(),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(['text/plain', 'text/markdown', 'application/json']),
  sizeBytes: z.number().int().positive().max(40_000),
  uploadedAt: TimestampSchema,
});

export const ExportedSourceDocumentSchema = SourceDocumentSchema.extend({
  content: z.string().trim().min(20).max(40_000),
});

export const AnalysisRequestSchema = z.object({
  attemptId: IdSchema,
  transcript: z.string().trim().min(1).max(12_000),
  criteria: z.array(CriterionSchema).min(1).max(20),
});

export const AnalysisResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  attemptId: IdSchema,
  verdicts: z.array(EvidenceVerdictSchema).min(1).max(20),
  question: QuestionSchema,
});

export const ApiErrorSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  error: z.object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.literal('ready'),
  contractVersion: z.literal(CONTRACT_VERSION),
});

export const CapabilitiesResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  persistence: z.enum(['local', 'neon']),
  accounts: z.boolean(),
  sourceDocuments: z.boolean(),
  recordings: z.boolean(),
  semantic: z.object({
    rubric: z.boolean(),
    evidence: z.boolean(),
    question: z.boolean(),
    defense: z.boolean(),
  }),
});

export const VisionModeSchema = z.enum(['interview', 'presentation']);
export const DeliveryEventSourceSchema = z.enum([
  'acoustic',
  'interim-transcript',
  'combined',
  'vision',
]);
export const RecordingStatusSchema = z.enum(['pending', 'ready', 'failed']);

export const AttemptDeliveryReviewSchema = z.object({
  attemptId: IdSchema,
  mode: VisionModeSchema,
  vocalScore: z.number().int().min(0).max(100),
  visualScore: z.number().int().min(0).max(100).nullable(),
  trackingCoveragePercent: z.number().int().min(0).max(100).nullable(),
  fillerCount: z.number().int().nonnegative(),
  repeatedWordCount: z.number().int().nonnegative(),
  boundary: z.string().trim().min(1).max(2_000),
  createdAt: TimestampSchema,
});

const AttemptDeliveryEventObjectSchema = z.object({
  id: IdSchema,
  attemptId: IdSchema,
  source: DeliveryEventSourceSchema,
  kind: z.string().trim().min(1).max(64),
  startMs: z.number().int().min(0).max(3_600_000),
  endMs: z.number().int().min(0).max(3_600_000),
  label: z.string().trim().min(1).max(200),
  evidence: z.string().trim().min(1).max(2_000),
  createdAt: TimestampSchema,
});

export const AttemptDeliveryEventSchema = AttemptDeliveryEventObjectSchema.refine((value) => value.endMs >= value.startMs, {
  path: ['endMs'],
  message: 'A delivery event must end at or after it starts.',
});

export const AttemptRecordingSchema = z.object({
  id: IdSchema,
  attemptId: IdSchema,
  status: RecordingStatusSchema,
  contentType: z.enum(['video/webm', 'video/mp4']),
  sizeBytes: z.number().int().positive().max(250_000_000).nullable(),
  durationMs: z.number().int().positive().max(3_600_000),
  expiresAt: TimestampSchema,
  createdAt: TimestampSchema,
  uploadedAt: OptionalTimestampSchema,
});

const NewAttemptDeliveryEventSchema = AttemptDeliveryEventObjectSchema.omit({
  id: true,
  attemptId: true,
  createdAt: true,
}).refine((value) => value.endMs >= value.startMs, {
  path: ['endMs'],
  message: 'A delivery event must end at or after it starts.',
});

export const SaveAttemptDeliveryReviewRequestSchema = AttemptDeliveryReviewSchema.omit({
  attemptId: true,
  createdAt: true,
}).extend({
  events: z.array(NewAttemptDeliveryEventSchema).max(500),
});

export const SaveAttemptDeliveryReviewResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  deliveryReview: AttemptDeliveryReviewSchema,
  deliveryEvents: z.array(AttemptDeliveryEventSchema).max(500),
});

export const RecordingInitRequestSchema = z.object({
  contentType: z.string().trim().min(1).max(200),
  durationMs: z.number().int().positive().max(3_600_000),
});

export const RecordingInitResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  recording: AttemptRecordingSchema,
  uploadPathname: z.string().trim().min(1).max(1_000),
});

export const RecordingFinalizeRequestSchema = z.object({
  pathname: z.string().trim().min(1).max(1_000),
  url: z.url(),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(250_000_000),
  durationMs: z.number().int().positive().max(3_600_000),
});

export const RecordingFinalizeResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  recording: AttemptRecordingSchema,
});

export const AttemptReviewEvidenceSchema = z.object({
  criterionId: IdSchema,
  criterionName: z.string().trim().min(1).max(200),
  verdict: EvidenceVerdictValueSchema,
  coverageScore: CoverageScoreSchema,
  citedSpan: z.string().max(12_000).nullable(),
  missingEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
});

export const AttemptReviewResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  attempt: AttemptSchema,
  deliveryReview: AttemptDeliveryReviewSchema.nullable(),
  deliveryEvents: z.array(AttemptDeliveryEventSchema).max(500),
  recording: AttemptRecordingSchema.nullable(),
  evidence: z.array(AttemptReviewEvidenceSchema).max(20),
});

export const AttemptRecordingDeleteResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  deleted: z.literal(true),
});

export const RubricParseRequestSchema = z.object({
  rubricText: z.string().trim().min(1).max(8_000),
});

export const ParsedCriterionSchema = z.object({
  clientId: IdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  requiredEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  sourceExcerpt: z.string().trim().min(1).max(2_000),
  displayOrder: z.number().int().nonnegative(),
});

export const RubricParseResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  criteria: z.array(ParsedCriterionSchema).min(1).max(20),
  mode: z.enum(['semantic', 'deterministic']),
  model: z.string().min(1).nullable(),
  requiresConfirmation: z.literal(true),
});

const NewCriterionSchema = CriterionSchema.omit({ id: true, rubricId: true });

export const CreateProjectRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  eventContext: z.string().trim().max(500).nullable().default(null),
  deadline: z.string().date().nullable().default(null),
});

export const CreateProjectResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  project: ProjectSchema,
});

const CurrentProjectWorkspaceSchema = z.object({
  project: ProjectSchema,
  rubric: RubricSchema.nullable(),
  criteria: z.array(CriterionSchema).max(20),
  sourceDocuments: z.array(SourceDocumentSchema).max(3),
}).superRefine((value, context) => {
  if ((value.rubric === null) !== (value.criteria.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['criteria'],
      message: 'Recovered criteria require their confirmed project rubric.',
    });
  }
  if (value.rubric && value.rubric.projectId !== value.project.id) {
    context.addIssue({
      code: 'custom',
      path: ['rubric', 'projectId'],
      message: 'The recovered rubric must belong to the recovered project.',
    });
  }
  if (value.criteria.some((criterion) => criterion.rubricId !== value.rubric?.id)) {
    context.addIssue({
      code: 'custom',
      path: ['criteria'],
      message: 'Every recovered criterion must belong to the recovered rubric.',
    });
  }
  if (value.sourceDocuments.some((document) => document.projectId !== value.project.id)) {
    context.addIssue({
      code: 'custom',
      path: ['sourceDocuments'],
      message: 'Every recovered source document must belong to the recovered project.',
    });
  }
});

export const CurrentProjectResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  identity: z.enum(['account', 'guest']),
  current: CurrentProjectWorkspaceSchema.nullable(),
}).superRefine((value, context) => {
  if (value.identity === 'guest' && value.current !== null) {
    context.addIssue({
      code: 'custom',
      path: ['current'],
      message: 'An anonymous SQL identity cannot recover a private project.',
    });
  }
});

/**
 * One row of the project switcher.
 *
 * The workspace has always been able to hold more than one project — the table
 * is owner-scoped and `createOwnedProject` takes a title — but the interface
 * offered a `<select>` with a single hardcoded `<option>` in it. A control that
 * looks like a switcher and cannot switch is worse than no control: it teaches
 * a user that the product is smaller than it is, and it fails the first thing a
 * judge does with a dropdown, which is open it.
 */
export const ProjectSummarySchema = z.object({
  project: ProjectSchema,
  /** Reviewed attempts saved against this project. */
  attemptCount: z.number().int().nonnegative(),
  /** When the most recent attempt was saved, or null when there are none. */
  lastAttemptAt: TimestampSchema.nullable(),
  /** False until a rubric is confirmed; such a project cannot be practised yet. */
  rubricConfirmed: z.boolean(),
}).superRefine((value, context) => {
  if (value.attemptCount === 0 && value.lastAttemptAt !== null) {
    context.addIssue({
      code: 'custom',
      path: ['lastAttemptAt'],
      message: 'A project with no attempts cannot report when its last attempt was.',
    });
  }
});

// Only a signed-in owner can reach this list (M-9), so there is no guest shape
// to describe. A signed-out visitor gets a 401 and shows its local workspace.
export const ProjectListResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  identity: z.literal('account'),
  projects: z.array(ProjectSummarySchema).max(100),
});

export const ConfirmRubricRequestSchema = z.object({
  sourceType: RubricSourceSchema,
  criteria: z.array(NewCriterionSchema).min(1).max(20),
}).superRefine((value, context) => {
  const orders = new Set(value.criteria.map((criterion) => criterion.displayOrder));
  if (orders.size !== value.criteria.length) {
    context.addIssue({
      code: 'custom',
      path: ['criteria'],
      message: 'Each criterion must have a unique display order.',
    });
  }
});

export const ConfirmRubricResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  rubric: RubricSchema,
  criteria: z.array(CriterionSchema).min(1).max(20),
});

export const CreateAttemptRequestSchema = z.object({
  projectId: IdSchema,
  mode: AttemptModeSchema,
  transcript: z.string().trim().min(1).max(12_000),
  transcriptSource: TranscriptSourceSchema,
  durationSeconds: z.number().int().positive().max(3_600),
});

export const CreateAttemptResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  attempt: AttemptSchema,
});

export const ReusedCitationSchema = z.object({
  citedSpan: z.string().trim().min(1).max(12_000),
  criterionIds: z.array(IdSchema).min(2).max(20).refine(
    (criterionIds) => new Set(criterionIds).size === criterionIds.length,
    'A reused citation must name distinct criteria.',
  ),
});

export const StatelessInputCriterionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  requiredEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  displayOrder: z.number().int().nonnegative(),
});

export const StatelessAnalysisRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(12_000),
  criteria: z.array(StatelessInputCriterionSchema).min(1).max(20),
  durationSeconds: z.number().int().positive().max(3_600),
}).superRefine((value, context) => {
  const ids = new Set(value.criteria.map((criterion) => criterion.id));
  if (ids.size !== value.criteria.length) {
    context.addIssue({
      code: 'custom',
      path: ['criteria'],
      message: 'Every criterion must have a unique id.',
    });
  }
  const orders = new Set(value.criteria.map((criterion) => criterion.displayOrder));
  if (orders.size !== value.criteria.length) {
    context.addIssue({
      code: 'custom',
      path: ['criteria'],
      message: 'Every criterion must have a unique display order.',
    });
  }
});

export const StatelessCriterionSchema = z.object({
  id: IdSchema,
  label: z.string().trim().min(1).max(200),
  requirementText: z.string().trim().max(2_000),
  signals: z.array(z.string().trim().min(1).max(200)).max(40),
  score: z.number().min(0).max(100),
  status: z.enum(['covered', 'partial', 'missing']),
  matchedSignals: z.array(z.string().trim().min(1).max(200)).max(40),
  missingSignals: z.array(z.string().trim().min(1).max(200)).max(40),
  excerpt: z.string().max(12_000),
}).superRefine((value, context) => {
  if (value.status !== 'missing' && !value.excerpt.trim()) {
    context.addIssue({
      code: 'custom',
      path: ['excerpt'],
      message: 'Covered and partial criteria must retain their grounded transcript span.',
    });
  }
  if (value.status === 'missing' && value.excerpt !== '') {
    context.addIssue({
      code: 'custom',
      path: ['excerpt'],
      message: 'A missing criterion cannot retain a supporting transcript span.',
    });
  }
  if (value.status !== 'covered' && value.missingSignals.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingSignals'],
      message: 'Partial and missing criteria must name the evidence still missing.',
    });
  }
  if (value.status === 'covered' && value.missingSignals.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingSignals'],
      message: 'A covered criterion cannot also claim that evidence is missing.',
    });
  }
});

const StatelessDeliverySchema = z.object({
  wordCount: z.number().int().nonnegative(),
  durationSeconds: z.number().positive().max(3_600),
  wordsPerMinute: z.number().int().nonnegative(),
  pace: z.enum(['deliberate', 'steady', 'fast']),
  fillerCount: z.number().int().nonnegative(),
  fillers: z.array(z.object({
    label: z.string().trim().min(1).max(100),
    count: z.number().int().positive(),
  })).max(20),
});

const StatelessAnalysisResultSchema = z.object({
  evidenceScore: z.number().min(0).max(100),
  coveredCount: z.number().int().nonnegative(),
  criterionCount: z.number().int().positive().max(20),
  criteria: z.array(StatelessCriterionSchema).min(1).max(20),
  weakest: StatelessCriterionSchema,
  judgeQuestion: z.string().trim().min(1).max(2_000),
  drill: z.string().trim().min(1).max(2_000),
  delivery: StatelessDeliverySchema,
}).superRefine((value, context) => {
  if (value.criteria.length !== value.criterionCount) {
    context.addIssue({
      code: 'custom',
      path: ['criterionCount'],
      message: 'The criterion count must match the returned evidence rows.',
    });
  }
  if (!value.criteria.some((criterion) => criterion.id === value.weakest.id)) {
    context.addIssue({
      code: 'custom',
      path: ['weakest', 'id'],
      message: 'The weakest criterion must exist in the returned evidence rows.',
    });
  }
  if (new Set(value.criteria.map((criterion) => criterion.id)).size !== value.criteria.length) {
    context.addIssue({
      code: 'custom',
      path: ['criteria'],
      message: 'The returned criteria must have unique ids.',
    });
  }
});

export const StatelessAnalysisResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  analysis: StatelessAnalysisResultSchema,
  mode: z.enum(['semantic', 'mixed', 'deterministic']),
  criterionEngines: z.array(z.object({
    criterionId: IdSchema,
    engine: EvidenceEngineSchema,
  })).min(1).max(20),
  reusedCitations: z.array(ReusedCitationSchema).max(20),
  questionEngine: EvidenceEngineSchema,
  cached: z.boolean(),
}).superRefine((value, context) => {
  const analysisIds = new Set(value.analysis.criteria.map((criterion) => criterion.id));
  const engineIds = new Set(value.criterionEngines.map((item) => item.criterionId));
  if (
    analysisIds.size !== value.analysis.criteria.length
    || engineIds.size !== value.criterionEngines.length
    || analysisIds.size !== engineIds.size
    || [...analysisIds].some((id) => !engineIds.has(id))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['criterionEngines'],
      message: 'Every returned criterion must have exactly one analysis engine.',
    });
  }
});

const StatelessJudgmentSchema = z.object({
  criterionId: IdSchema,
  verdict: EvidenceVerdictValueSchema,
  coverageScore: CoverageScoreSchema,
  citedSpan: z.string().max(12_000).nullable(),
  missingEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  engine: EvidenceEngineSchema,
  degradedReason: z.string().trim().min(1).max(500).nullable(),
}).superRefine((value, context) => {
  if (value.verdict !== 'unsupported' && !value.citedSpan?.trim()) {
    context.addIssue({
      code: 'custom',
      path: ['citedSpan'],
      message: 'A supported or partial judgment must cite the answer or transcript.',
    });
  }
  if (value.verdict === 'unsupported' && value.citedSpan !== null) {
    context.addIssue({
      code: 'custom',
      path: ['citedSpan'],
      message: 'An unsupported judgment cannot retain a supporting citation.',
    });
  }
  if (value.verdict !== 'supported' && value.missingEvidence.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingEvidence'],
      message: 'A partial or unsupported judgment must name the missing evidence.',
    });
  }
  if (value.verdict === 'supported' && value.missingEvidence.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingEvidence'],
      message: 'A supported judgment cannot retain missing evidence.',
    });
  }
});

const RejectedStatelessJudgmentSchema = z.object({
  verdict: EvidenceVerdictValueSchema,
  coverageScore: CoverageScoreSchema,
  citedSpan: z.string().max(12_000).nullable(),
  missingEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  engine: EvidenceEngineSchema,
}).superRefine((value, context) => {
  if (value.verdict !== 'unsupported' && !value.citedSpan?.trim()) {
    context.addIssue({
      code: 'custom',
      path: ['citedSpan'],
      message: 'A supported or partial rejected judgment must retain its citation.',
    });
  }
  if (value.verdict === 'unsupported' && value.citedSpan !== null) {
    context.addIssue({
      code: 'custom',
      path: ['citedSpan'],
      message: 'An unsupported rejected judgment cannot retain a citation.',
    });
  }
  if (value.verdict !== 'supported' && value.missingEvidence.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingEvidence'],
      message: 'A partial or unsupported rejected judgment must retain its evidence gap.',
    });
  }
  if (value.verdict === 'supported' && value.missingEvidence.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingEvidence'],
      message: 'A supported rejected judgment cannot retain missing evidence.',
    });
  }
});

export const StatelessRejudgeRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(12_000),
  criterion: CriterionSchema,
  rejected: RejectedStatelessJudgmentSchema,
});

export const StatelessRejudgeResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  judgment: StatelessJudgmentSchema,
  questionTargetCriterionId: IdSchema,
  questionText: z.string().trim().min(1).max(2_000),
  questionEngine: EvidenceEngineSchema,
  mode: z.enum(['semantic', 'mixed', 'deterministic']),
}).superRefine((value, context) => {
  if (value.questionTargetCriterionId !== value.judgment.criterionId) {
    context.addIssue({
      code: 'custom',
      path: ['questionTargetCriterionId'],
      message: 'The refreshed question must target the re-judged criterion.',
    });
  }
});

export const ClaimCoachRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(12_000),
  criteria: z.array(StatelessInputCriterionSchema).min(1).max(20),
});

export const CoachedClaimSchema = z.object({
  citedSpan: z.string().trim().min(1).max(500),
  supported: z.boolean(),
  supportSpan: z.string().trim().min(1).max(500).nullable(),
  invitedQuestion: z.string().trim().min(1).max(300).nullable(),
});

export const CriterionCoachingSchema = z.object({
  criterionId: IdSchema,
  claims: z.array(CoachedClaimSchema).max(8),
  // Readings whose quotes failed the exact-span check. Counted and shown,
  // never quietly hidden: a rejection rate is evidence about the tool.
  discardedClaims: z.number().int().nonnegative().max(24),
  strongerForm: z.string().trim().min(1).max(2_000).nullable(),
  blanks: z.array(z.string().trim().min(1).max(200)).max(6),
  degradedReason: z.string().trim().min(1).max(1_000).nullable(),
  model: z.string().trim().min(1).max(200).nullable(),
});

export const ClaimCoachResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  coachings: z.array(CriterionCoachingSchema).min(1).max(20),
});

export const StatelessDefenseRequestSchema = z.object({
  answerText: z.string().trim().min(1).max(12_000),
  criterion: CriterionSchema,
});

export const StatelessDefenseResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  judgment: StatelessJudgmentSchema,
});

export const EvidenceResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  attemptId: IdSchema,
  verdicts: z.array(EvidenceVerdictSchema).min(1).max(20),
  reusedCitations: z.array(ReusedCitationSchema).max(20).default([]),
  degraded: z.boolean(),
}).superRefine((value, context) => {
  const verdictCriterionIds = new Set(value.verdicts.map((verdict) => verdict.criterionId));
  for (const [reuseIndex, reuse] of value.reusedCitations.entries()) {
    for (const criterionId of reuse.criterionIds) {
      if (!verdictCriterionIds.has(criterionId)) {
        context.addIssue({
          code: 'custom',
          path: ['reusedCitations', reuseIndex, 'criterionIds'],
          message: 'Every reused citation criterion must exist in this evidence response.',
        });
      }
    }
  }
});

export const EvidenceConfirmationRequestSchema = z.object({
  accepted: z.boolean(),
});

export const EvidenceConfirmationResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  confirmation: EvidenceConfirmationSchema,
  verdict: EvidenceVerdictSchema,
  rejudged: z.boolean(),
  degraded: z.boolean(),
}).superRefine((value, context) => {
  if (value.rejudged !== !value.confirmation.accepted) {
    context.addIssue({
      code: 'custom',
      path: ['rejudged'],
      message: 'Only a rejected verdict may be re-judged, and every rejection is re-judged once.',
    });
  }
  if (value.rejudged !== (value.confirmation.rejudgedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['confirmation', 'rejudgedAt'],
      message: 'The persisted re-judge timestamp must match the response state.',
    });
  }
});

export const QuestionResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  question: QuestionSchema,
  sourceDocument: SourceDocumentSchema.nullable(),
  engine: EvidenceEngineSchema,
  model: z.string().min(1).nullable(),
  degradedReason: z.string().min(1).nullable(),
}).superRefine((value, context) => {
  if (value.question.sourceDocumentId !== (value.sourceDocument?.id ?? null)) {
    context.addIssue({
      code: 'custom',
      path: ['sourceDocument'],
      message: 'Question provenance must include the exact source document it names.',
    });
  }
});

export const SourceDocumentUploadResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  sourceDocument: SourceDocumentSchema,
});

export const SourceDocumentListResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  sourceDocuments: z.array(SourceDocumentSchema).max(3),
});

export const SourceDocumentDeleteResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  deleted: z.literal(true),
});

export const DefenseRequestSchema = z.object({
  answerText: z.string().trim().min(1).max(12_000),
});

export const DefenseResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  answer: DefenseAnswerSchema,
  verdict: EvidenceVerdictSchema,
  degraded: z.boolean(),
});

export const ProgressPointSchema = z.object({
  attemptId: IdSchema,
  createdAt: TimestampSchema,
  coverage: z.number().min(0).max(1),
  hasDeliveryReview: z.boolean(),
  recordingStatus: RecordingStatusSchema.nullable(),
});

export const RecurringWeaknessSchema = z.object({
  criterionId: IdSchema,
  criterionName: z.string().trim().min(1).max(200),
  attemptCount: z.number().int().positive(),
  gapCount: z.number().int().nonnegative(),
  averageCoverage: z.number().min(0).max(1).nullable(),
  latestAttemptId: IdSchema.nullable(),
  latestAt: TimestampSchema,
  latestCitedSpan: z.string().trim().min(1).max(12_000).nullable(),
  latestMissingEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
  summaryOnly: z.boolean(),
}).superRefine((value, context) => {
  if (value.gapCount > value.attemptCount) {
    context.addIssue({
      code: 'custom',
      path: ['gapCount'],
      message: 'A gap count cannot exceed the attempts observed.',
    });
  }
  if (!value.summaryOnly && !value.latestCitedSpan && value.latestMissingEvidence.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['latestMissingEvidence'],
      message: 'A recurring verdict must retain its latest citation or explicit evidence gap.',
    });
  }
});

export const SavedCriterionResultSchema = z.object({
  criterionId: IdSchema,
  criterionName: z.string().trim().min(1).max(200),
  verdict: EvidenceVerdictValueSchema,
  coverage: z.number().min(0).max(1),
  citedSpan: z.string().trim().min(1).max(12_000).nullable(),
  missingEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
}).superRefine((value, context) => {
  if (value.verdict !== 'unsupported' && !value.citedSpan) {
    context.addIssue({
      code: 'custom',
      path: ['citedSpan'],
      message: 'Supported and partial local results must retain their cited span.',
    });
  }
  if (value.verdict === 'unsupported' && value.citedSpan !== null) {
    context.addIssue({
      code: 'custom',
      path: ['citedSpan'],
      message: 'Unsupported local results cannot retain a supporting citation.',
    });
  }
  if (value.verdict !== 'supported' && value.missingEvidence.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingEvidence'],
      message: 'Partial and unsupported local results must retain their explicit evidence gap.',
    });
  }
  if (value.verdict === 'supported' && value.missingEvidence.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['missingEvidence'],
      message: 'A supported local result cannot retain missing evidence.',
    });
  }
});

export const SavedSessionSchema = z.object({
  id: IdSchema,
  createdAt: TimestampSchema,
  evidenceScore: z.number().min(0).max(100),
  weakest: z.string().trim().min(1).max(200),
  defenseStatus: z.enum(['defensible', 'developing', 'vulnerable']).nullable(),
  projectId: IdSchema.nullable().default(null),
  criteria: z.array(SavedCriterionResultSchema).max(20).default([]),
});

export const CriterionComparisonDirectionSchema = z.enum([
  'improved',
  'regressed',
  'unchanged',
  'added',
  'removed',
]);

export const CriterionAttemptComparisonSchema = z.object({
  criterionId: IdSchema,
  criterionName: z.string().trim().min(1).max(200),
  previous: SavedCriterionResultSchema.nullable(),
  current: SavedCriterionResultSchema.nullable(),
  coverageDelta: z.number().min(-1).max(1),
  direction: CriterionComparisonDirectionSchema,
}).superRefine((value, context) => {
  if (!value.previous && !value.current) {
    context.addIssue({
      code: 'custom',
      path: ['current'],
      message: 'An attempt comparison must retain evidence from at least one side.',
    });
    return;
  }
  const expectedDelta = (value.current?.coverage ?? 0) - (value.previous?.coverage ?? 0);
  if (value.coverageDelta !== expectedDelta) {
    context.addIssue({
      code: 'custom',
      path: ['coverageDelta'],
      message: 'Coverage movement must equal the two retained criterion readings.',
    });
  }
  const expectedDirection = !value.previous
    ? 'added'
    : !value.current
      ? 'removed'
      : expectedDelta > 0 ? 'improved' : expectedDelta < 0 ? 'regressed' : 'unchanged';
  if (value.direction !== expectedDirection) {
    context.addIssue({
      code: 'custom',
      path: ['direction'],
      message: 'The comparison direction must describe explicit coverage movement only.',
    });
  }
});

export const AttemptComparisonSchema = z.object({
  previousAttemptId: IdSchema,
  previousCreatedAt: TimestampSchema,
  currentAttemptId: IdSchema,
  currentCreatedAt: TimestampSchema,
  criteria: z.array(CriterionAttemptComparisonSchema).min(1).max(40),
}).superRefine((value, context) => {
  if (value.previousAttemptId === value.currentAttemptId) {
    context.addIssue({
      code: 'custom',
      path: ['currentAttemptId'],
      message: 'An attempt cannot be compared with itself.',
    });
  }
  if (value.currentCreatedAt < value.previousCreatedAt) {
    context.addIssue({
      code: 'custom',
      path: ['currentCreatedAt'],
      message: 'The current side must not precede the previous attempt.',
    });
  }
});

export const ProgressResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  projectId: IdSchema,
  attempts: z.array(ProgressPointSchema),
  recurringWeaknesses: z.array(RecurringWeaknessSchema),
  attemptComparisons: z.array(AttemptComparisonSchema),
});

export const WorkspaceExportSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  exportedAt: TimestampSchema,
  projects: z.array(ProjectSchema),
  rubrics: z.array(RubricSchema),
  criteria: z.array(CriterionSchema),
  attempts: z.array(AttemptSchema),
  verdicts: z.array(EvidenceVerdictSchema),
  evidenceConfirmations: z.array(EvidenceConfirmationSchema),
  questions: z.array(QuestionSchema),
  defenseAnswers: z.array(DefenseAnswerSchema),
  sourceDocuments: z.array(ExportedSourceDocumentSchema),
  deliveryReviews: z.array(AttemptDeliveryReviewSchema),
  deliveryEvents: z.array(AttemptDeliveryEventSchema),
  recordings: z.array(AttemptRecordingSchema),
});

export const DeleteAccountRequestSchema = z.object({
  confirmation: z.literal('DELETE MY TALK-ACTIVE DATA'),
});

export const DeleteAccountResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  deleted: z.literal(true),
});

export const LegacyWorkspaceImportSchema = z.object({
  version: z.literal(1),
  projects: z.array(z.object({
    id: IdSchema,
    name: z.string().trim().min(1).max(160),
    event: z.string().trim().max(500),
    deadline: z.string().date().nullable().optional(),
    rubric: z.string().trim().min(1).max(8_000),
    draft: z.string().max(12_000),
    draftDuration: z.number().int().positive().max(3_600),
    createdAt: TimestampSchema,
  })).min(1).max(50),
  sessions: z.array(z.object({
    id: IdSchema,
    projectId: IdSchema,
    createdAt: TimestampSchema,
    evidenceScore: z.number().min(0).max(100),
    weakest: z.string().trim().min(1).max(200),
    defenseStatus: z.enum(['defensible', 'developing', 'vulnerable']).nullable(),
    title: z.string().trim().min(1).max(200),
  })).max(500),
}).passthrough();

export const LegacyImportResponseSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  importedProjects: z.number().int().nonnegative(),
  importedSessions: z.number().int().nonnegative(),
  sourceRetained: z.literal(true),
});

export type Project = z.infer<typeof ProjectSchema>;
export type Rubric = z.infer<typeof RubricSchema>;
export type RubricSource = z.infer<typeof RubricSourceSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictSchema>;
export type EvidenceConfirmation = z.infer<typeof EvidenceConfirmationSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionBasis = z.infer<typeof QuestionBasisSchema>;
export type DefenseAnswer = z.infer<typeof DefenseAnswerSchema>;
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;
export type ExportedSourceDocument = z.infer<typeof ExportedSourceDocumentSchema>;
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type RubricParseRequest = z.infer<typeof RubricParseRequestSchema>;
export type ParsedCriterion = z.infer<typeof ParsedCriterionSchema>;
export type RubricParseResponse = z.infer<typeof RubricParseResponseSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;
export type CurrentProjectResponse = z.infer<typeof CurrentProjectResponseSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
export type ConfirmRubricRequest = z.infer<typeof ConfirmRubricRequestSchema>;
export type ConfirmRubricResponse = z.infer<typeof ConfirmRubricResponseSchema>;
export type CreateAttemptRequest = z.infer<typeof CreateAttemptRequestSchema>;
export type CreateAttemptResponse = z.infer<typeof CreateAttemptResponseSchema>;
export type EvidenceResponse = z.infer<typeof EvidenceResponseSchema>;
export type EvidenceConfirmationRequest = z.infer<typeof EvidenceConfirmationRequestSchema>;
export type EvidenceConfirmationResponse = z.infer<typeof EvidenceConfirmationResponseSchema>;
export type ReusedCitation = z.infer<typeof ReusedCitationSchema>;
export type StatelessAnalysisRequest = z.infer<typeof StatelessAnalysisRequestSchema>;
export type StatelessAnalysisResponse = z.infer<typeof StatelessAnalysisResponseSchema>;
export type StatelessInputCriterion = z.infer<typeof StatelessInputCriterionSchema>;
export type StatelessRejudgeRequest = z.infer<typeof StatelessRejudgeRequestSchema>;
export type StatelessRejudgeResponse = z.infer<typeof StatelessRejudgeResponseSchema>;
export type StatelessDefenseRequest = z.infer<typeof StatelessDefenseRequestSchema>;
export type StatelessDefenseResponse = z.infer<typeof StatelessDefenseResponseSchema>;
export type ClaimCoachRequest = z.infer<typeof ClaimCoachRequestSchema>;
export type ClaimCoachResponse = z.infer<typeof ClaimCoachResponseSchema>;
export type CriterionCoaching = z.infer<typeof CriterionCoachingSchema>;
export type CoachedClaim = z.infer<typeof CoachedClaimSchema>;
export type QuestionResponse = z.infer<typeof QuestionResponseSchema>;
export type SourceDocumentUploadResponse = z.infer<typeof SourceDocumentUploadResponseSchema>;
export type SourceDocumentListResponse = z.infer<typeof SourceDocumentListResponseSchema>;
export type SourceDocumentDeleteResponse = z.infer<typeof SourceDocumentDeleteResponseSchema>;
export type DefenseRequest = z.infer<typeof DefenseRequestSchema>;
export type DefenseResponse = z.infer<typeof DefenseResponseSchema>;
export type ProgressResponse = z.infer<typeof ProgressResponseSchema>;
export type RecurringWeakness = z.infer<typeof RecurringWeaknessSchema>;
export type SavedCriterionResult = z.infer<typeof SavedCriterionResultSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;
export type CriterionComparisonDirection = z.infer<typeof CriterionComparisonDirectionSchema>;
export type CriterionAttemptComparison = z.infer<typeof CriterionAttemptComparisonSchema>;
export type AttemptComparison = z.infer<typeof AttemptComparisonSchema>;
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;
export type VisionMode = z.infer<typeof VisionModeSchema>;
export type DeliveryEventSource = z.infer<typeof DeliveryEventSourceSchema>;
export type AttemptDeliveryReview = z.infer<typeof AttemptDeliveryReviewSchema>;
export type AttemptDeliveryEvent = z.infer<typeof AttemptDeliveryEventSchema>;
export type AttemptRecording = z.infer<typeof AttemptRecordingSchema>;
export type SaveAttemptDeliveryReviewRequest = z.infer<typeof SaveAttemptDeliveryReviewRequestSchema>;
export type SaveAttemptDeliveryReviewResponse = z.infer<typeof SaveAttemptDeliveryReviewResponseSchema>;
export type RecordingInitRequest = z.infer<typeof RecordingInitRequestSchema>;
export type RecordingInitResponse = z.infer<typeof RecordingInitResponseSchema>;
export type RecordingFinalizeRequest = z.infer<typeof RecordingFinalizeRequestSchema>;
export type RecordingFinalizeResponse = z.infer<typeof RecordingFinalizeResponseSchema>;
export type AttemptReviewResponse = z.infer<typeof AttemptReviewResponseSchema>;
export type AttemptRecordingDeleteResponse = z.infer<typeof AttemptRecordingDeleteResponseSchema>;
export type WorkspaceExport = z.infer<typeof WorkspaceExportSchema>;
