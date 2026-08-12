import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user as authUsers } from './auth-schema.generated';

export {
  account,
  accountRelations,
  session,
  sessionRelations,
  user,
  userRelations,
  verification,
} from './auth-schema.generated';

const timestampColumns = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
};

export const rubricSource = pgEnum('rubric_source', ['manual', 'imported', 'library']);
export const attemptMode = pgEnum('attempt_mode', ['typed', 'dictated']);
export const attemptStatus = pgEnum('attempt_status', [
  'draft',
  'analysing',
  'review',
  'defending',
  'complete',
  'failed',
]);
export const transcriptSource = pgEnum('transcript_source', ['typed', 'web-speech', 'imported']);
export const evidenceStage = pgEnum('evidence_stage', ['initial', 'defense']);
export const evidenceVerdict = pgEnum('evidence_verdict', ['supported', 'partial', 'unsupported']);
export const evidenceEngine = pgEnum('evidence_engine', ['semantic', 'deterministic']);
export const questionBasis = pgEnum('question_basis', [
  'transcript',
  'missing-evidence',
  'source-document',
  'legacy-unknown',
]);

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Guest projects have no owner. Account sync binds the same project shape to
  // Better Auth's generated user table in our Singapore Postgres deployment.
  userId: text('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 160 }).notNull(),
  eventContext: text('event_context'),
  deadline: date('deadline', { mode: 'string' }),
  ...timestampColumns,
}, (table) => [
  index('projects_user_id_idx').on(table.userId),
  index('projects_updated_at_idx').on(table.updatedAt),
]);

export const rubrics = pgTable('rubrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  sourceType: rubricSource('source_type').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
}, (table) => [
  uniqueIndex('rubrics_project_id_unique').on(table.projectId),
]);

export const criteria = pgTable('criteria', {
  id: uuid('id').defaultRandom().primaryKey(),
  rubricId: uuid('rubric_id')
    .notNull()
    .references(() => rubrics.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description').default('').notNull(),
  requiredEvidence: jsonb('required_evidence').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  displayOrder: integer('display_order').notNull(),
}, (table) => [
  uniqueIndex('criteria_rubric_order_unique').on(table.rubricId, table.displayOrder),
  check('criteria_display_order_nonnegative', sql`${table.displayOrder} >= 0`),
]);

export const attempts = pgTable('attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  mode: attemptMode('mode').notNull(),
  status: attemptStatus('status').default('draft').notNull(),
  transcript: text('transcript').default('').notNull(),
  transcriptSource: transcriptSource('transcript_source').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  // The vanilla v1 snapshot retained only these session summaries. Keeping
  // them explicitly avoids inventing a transcript or evidence span on import.
  legacyTitle: varchar('legacy_title', { length: 200 }),
  legacyEvidenceCoverage: numeric('legacy_evidence_coverage', { precision: 5, scale: 2, mode: 'number' }),
  legacyWeakest: varchar('legacy_weakest', { length: 200 }),
  legacyDefenseStatus: varchar('legacy_defense_status', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
}, (table) => [
  index('attempts_project_created_at_idx').on(table.projectId, table.createdAt),
  check('attempts_duration_positive', sql`${table.durationSeconds} > 0`),
  check('attempts_transcript_length', sql`char_length(${table.transcript}) <= 12000`),
  check(
    'attempts_legacy_coverage_domain',
    sql`${table.legacyEvidenceCoverage} is null or (${table.legacyEvidenceCoverage} >= 0 and ${table.legacyEvidenceCoverage} <= 100)`,
  ),
]);

export const evidenceVerdicts = pgTable('evidence_verdicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  attemptId: uuid('attempt_id')
    .notNull()
    .references(() => attempts.id, { onDelete: 'cascade' }),
  criterionId: uuid('criterion_id')
    .notNull()
    .references(() => criteria.id, { onDelete: 'cascade' }),
  stage: evidenceStage('stage').notNull(),
  verdict: evidenceVerdict('verdict').notNull(),
  coverageScore: numeric('coverage_score', { precision: 2, scale: 1, mode: 'number' }).notNull(),
  citedSpan: text('cited_span'),
  missingEvidence: jsonb('missing_evidence').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  engine: evidenceEngine('engine').notNull(),
  verifierAgreed: boolean('verifier_agreed'),
  verifierNote: text('verifier_note'),
  studentOverridden: boolean('student_overridden').default(false).notNull(),
  studentOverrideVerdict: evidenceVerdict('student_override_verdict'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
}, (table) => [
  index('evidence_verdicts_attempt_idx').on(table.attemptId),
  index('evidence_verdicts_criterion_idx').on(table.criterionId),
  uniqueIndex('evidence_verdicts_attempt_criterion_stage_unique')
    .on(table.attemptId, table.criterionId, table.stage),
  check('evidence_verdicts_coverage_domain', sql`${table.coverageScore} in (0, 0.5, 1)`),
  check(
    'evidence_verdicts_supported_or_partial_has_span',
    sql`${table.verdict} = 'unsupported' or char_length(trim(${table.citedSpan})) > 0`,
  ),
  check(
    'evidence_verdicts_unsupported_has_no_span',
    sql`${table.verdict} <> 'unsupported' or ${table.citedSpan} is null`,
  ),
  check(
    'evidence_verdicts_non_supported_has_gap',
    sql`${table.verdict} = 'supported' or jsonb_array_length(${table.missingEvidence}) > 0`,
  ),
  check(
    'evidence_verdicts_override_consistent',
    sql`${table.studentOverridden} = (${table.studentOverrideVerdict} is not null)`,
  ),
]);

// Student sufficiency labels are an evaluation set, never training data. Keep
// the judged verdict as an immutable snapshot: a rejected verdict may be
// replaced by one re-judge, but the disagreement that caused it must survive.
export const evidenceConfirmations = pgTable('evidence_confirmations', {
  id: uuid('id').defaultRandom().primaryKey(),
  evidenceVerdictId: uuid('evidence_verdict_id')
    .notNull()
    .references(() => evidenceVerdicts.id, { onDelete: 'cascade' }),
  accepted: boolean('accepted').notNull(),
  judgedVerdict: evidenceVerdict('judged_verdict').notNull(),
  judgedCoverageScore: numeric('judged_coverage_score', { precision: 2, scale: 1, mode: 'number' }).notNull(),
  judgedCitedSpan: text('judged_cited_span'),
  judgedMissingEvidence: jsonb('judged_missing_evidence').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  judgedEngine: evidenceEngine('judged_engine').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
  rejudgedAt: timestamp('rejudged_at', { withTimezone: true, mode: 'string' }),
}, (table) => [
  uniqueIndex('evidence_confirmations_verdict_unique').on(table.evidenceVerdictId),
  index('evidence_confirmations_created_at_idx').on(table.createdAt),
  check(
    'evidence_confirmations_coverage_domain',
    sql`${table.judgedCoverageScore} in (0, 0.5, 1)`,
  ),
  check(
    'evidence_confirmations_supported_or_partial_has_span',
    sql`${table.judgedVerdict} = 'unsupported' or char_length(trim(${table.judgedCitedSpan})) > 0`,
  ),
  check(
    'evidence_confirmations_unsupported_has_no_span',
    sql`${table.judgedVerdict} <> 'unsupported' or ${table.judgedCitedSpan} is null`,
  ),
  check(
    'evidence_confirmations_non_supported_has_gap',
    sql`${table.judgedVerdict} = 'supported' or jsonb_array_length(${table.judgedMissingEvidence}) > 0`,
  ),
  check(
    'evidence_confirmations_acceptance_does_not_rejudge',
    sql`not ${table.accepted} or ${table.rejudgedAt} is null`,
  ),
]);

export const sourceDocuments = pgTable('source_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  blobUrl: text('blob_url').notNull(),
  filename: varchar('filename', { length: 255 }).notNull(),
  contentType: varchar('content_type', { length: 100 }).default('text/plain').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
}, (table) => [
  index('source_documents_project_idx').on(table.projectId),
  check('source_documents_size_domain', sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 40000`),
  check(
    'source_documents_content_type_allowed',
    sql`${table.contentType} in ('text/plain', 'text/markdown', 'application/json')`,
  ),
]);

export const questions = pgTable('questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  attemptId: uuid('attempt_id')
    .notNull()
    .references(() => attempts.id, { onDelete: 'cascade' }),
  targetCriterionId: uuid('target_criterion_id')
    .notNull()
    .references(() => criteria.id, { onDelete: 'cascade' }),
  questionText: text('question_text').notNull(),
  challengedClaim: text('challenged_claim').notNull(),
  basis: questionBasis('basis').default('legacy-unknown').notNull(),
  sourceDocumentId: uuid('source_document_id')
    .references(() => sourceDocuments.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
}, (table) => [
  uniqueIndex('questions_attempt_unique').on(table.attemptId),
  check(
    'questions_source_basis_consistent',
    sql`(${table.basis} = 'source-document') = (${table.sourceDocumentId} is not null)`,
  ),
]);

export const defenseAnswers = pgTable('defense_answers', {
  id: uuid('id').defaultRandom().primaryKey(),
  questionId: uuid('question_id')
    .notNull()
    .references(() => questions.id, { onDelete: 'cascade' }),
  answerText: text('answer_text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
}, (table) => [
  uniqueIndex('defense_answers_question_unique').on(table.questionId),
]);
