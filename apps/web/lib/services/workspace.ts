import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { judgeDefense } from '../ai/defense-judge';
import {
  judgeEvidence,
  rejudgeCriterionAfterRejection,
  type EvidenceJudgeOptions,
} from '../ai/evidence-judge';
import { detectReusedCitations } from '../citation-reuse';
import {
  generateJudgeQuestion,
  type QuestionGeneratorOptions,
} from '../ai/question-generator';
import { ApiProblem, notFound } from '../api/http';
import {
  ConfirmRubricResponseSchema,
  CONTRACT_VERSION,
  CreateAttemptResponseSchema,
  CreateProjectResponseSchema,
  CurrentProjectResponseSchema,
  DefenseResponseSchema,
  EvidenceConfirmationResponseSchema,
  EvidenceResponseSchema,
  EvidenceVerdictSchema,
  ProgressResponseSchema,
  ProjectListResponseSchema,
  ProjectWorkspaceResponseSchema,
  QuestionResponseSchema,
  SourceDocumentDeleteResponseSchema,
  SourceDocumentListResponseSchema,
  SourceDocumentSchema,
  SourceDocumentUploadResponseSchema,
  WorkspaceExportSchema,
  LegacyImportResponseSchema,
  UpdateProjectResponseSchema,
  type LegacyWorkspaceImportSchema,
  type ConfirmRubricRequest,
  type CreateAttemptRequest,
  type CreateProjectRequest,
  type UpdateProjectRequest,
  type DefenseRequest,
  type EvidenceConfirmationRequest,
  type SourceDocument,
} from '../contracts';
import type { Database } from '../db/client';
import {
  attemptDeliveryEvents,
  attemptDeliveryReviews,
  attemptRecordings,
  attempts,
  criteria,
  defenseAnswers,
  evidenceConfirmations,
  evidenceVerdicts,
  projects,
  questions,
  rubrics,
  sourceDocuments,
  user,
} from '../db/schema';
import { parseRubric } from '../analyzer';
import { compareAttemptEvidence } from '../progress';
import { selectWeakestCriterion } from '../weakest-criterion';
import {
  type RecordingStorage,
  vercelRecordingStorage,
} from '../attempt-recordings';
import {
  MAX_SOURCE_DOCUMENTS,
  SourceDocumentError,
  type SourceDocumentStorage,
  type SourceUpload,
  validateSourceUpload,
  vercelSourceDocumentStorage,
} from '../source-documents';
import type { z } from 'zod';

function now(): string {
  return new Date().toISOString();
}

function throwSourceProblem(error: unknown): never {
  if (error instanceof SourceDocumentError) {
    const status = error.code === 'invalid_source_document' ? 400 : 503;
    throw new ApiProblem(status, error.code, error.message, status === 503);
  }
  throw new ApiProblem(
    503,
    'source_document_unavailable',
    'Private source-document storage could not complete the request.',
    true,
  );
}

export async function createOwnedProject(
  db: Database,
  input: CreateProjectRequest,
  userId: string | null,
) {
  if (!userId) {
    throw new ApiProblem(
      401,
      'authentication_required',
      'Sign in before saving a project to the synced workspace.',
    );
  }
  const [project] = await db.insert(projects).values({
    userId,
    title: input.title,
    language: input.language,
    eventContext: input.eventContext,
    deadline: input.deadline,
  }).returning();
  if (!project) throw new Error('The project insert returned no row.');
  return CreateProjectResponseSchema.parse({ contractVersion: CONTRACT_VERSION, project });
}

/**
 * The 100 most recently active projects this account owns.
 *
 * One grouped query rather than a lookup per project: the switcher shows an
 * attempt count and a last-practised date per row, and doing that with a query
 * each would put an N+1 behind a control a user opens casually.
 *
 * The caller is already required to be a signed-in owner (M-9: these routes
 * reject an anonymous SQL identity, because guest rows used user_id = NULL and
 * NULL is not an owner). So there is no guest branch here to get wrong — a
 * signed-out visitor never reaches this function.
 */
export async function listOwnedProjects(db: Database, userId: string) {
  const rows = await db.select({
    project: projects,
    rubricConfirmedAt: rubrics.confirmedAt,
    attemptCount: sql<number>`count(distinct ${attempts.id})`,
    lastAttemptAt: sql<string | null>`max(${attempts.createdAt})`,
  })
    .from(projects)
    .leftJoin(rubrics, eq(rubrics.projectId, projects.id))
    .leftJoin(attempts, eq(attempts.projectId, projects.id))
    .where(eq(projects.userId, userId))
    .groupBy(projects.id, rubrics.confirmedAt)
    .orderBy(desc(projects.updatedAt), desc(projects.createdAt))
    // Keep the query and response contract in agreement. Without this limit,
    // the 101st project made the entire switcher response fail validation.
    .limit(100);

  return ProjectListResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    identity: 'account',
    projects: rows.map((row) => ({
      project: row.project,
      attemptCount: Number(row.attemptCount),
      // A count of zero cannot carry a date; the contract rejects that pair.
      lastAttemptAt: Number(row.attemptCount) === 0 ? null : row.lastAttemptAt,
      rubricConfirmed: row.rubricConfirmedAt !== null,
    })),
  });
}

async function assertProjectAccess(db: Database, projectId: string, userId: string | null) {
  if (!userId) {
    throw new ApiProblem(
      401,
      'authentication_required',
      'Sign in before accessing a synced project.',
    );
  }
  // Put the owner predicate in the lookup itself. Fetching by id and comparing
  // afterward makes it too easy for a future caller to use the row before the
  // ownership check, and it briefly loads another account's data into memory.
  const [project] = await db.select()
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      eq(projects.userId, userId),
    ))
    .limit(1);
  if (!project) notFound('Project');
  return project;
}

export async function getOwnedProjectById(
  db: Database,
  projectId: string,
  userId: string | null,
) {
  const project = await assertProjectAccess(db, projectId, userId);

  const [rubric] = await db.select().from(rubrics)
    .where(eq(rubrics.projectId, projectId))
    .limit(1);
  const recoveredCriteria = rubric
    ? await db.select().from(criteria)
      .where(eq(criteria.rubricId, rubric.id))
      .orderBy(asc(criteria.displayOrder))
    : [];
  const recoveredSources = await db.select().from(sourceDocuments)
    .where(eq(sourceDocuments.projectId, projectId))
    .orderBy(asc(sourceDocuments.uploadedAt));

  return ProjectWorkspaceResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    workspace: {
      project,
      rubric: rubric ?? null,
      criteria: recoveredCriteria,
      sourceDocuments: recoveredSources,
    },
  });
}

export async function updateOwnedProject(
  db: Database,
  projectId: string,
  input: UpdateProjectRequest,
  userId: string | null,
) {
  const owned = await assertProjectAccess(db, projectId, userId);
  const [project] = await db.update(projects)
    .set({ language: input.language, updatedAt: now() })
    // Keep the write owner-scoped too. Account ownership is not currently
    // mutable, but the predicate makes that safety independent of that fact.
    .where(and(
      eq(projects.id, projectId),
      eq(projects.userId, owned.userId!),
    ))
    .returning();
  if (!project) notFound('Project');
  return UpdateProjectResponseSchema.parse({ contractVersion: CONTRACT_VERSION, project });
}

export async function getCurrentOwnedProject(
  db: Database,
  userId: string | null,
) {
  // Guest project rows historically used user_id = NULL. SQL NULL is not an
  // owner identity: querying it would let one anonymous visitor discover
  // another visitor's workspace. Guests therefore stay local/stateless until
  // they explicitly create a synced account.
  if (!userId) {
    return CurrentProjectResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      identity: 'guest',
      current: null,
    });
  }

  const [owned] = await db.select({ project: projects, rubric: rubrics })
    .from(projects)
    .innerJoin(rubrics, and(
      eq(rubrics.projectId, projects.id),
      sql`${rubrics.confirmedAt} is not null`,
    ))
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt), desc(projects.createdAt))
    .limit(1);
  if (!owned) {
    return CurrentProjectResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      identity: 'account',
      current: null,
    });
  }

  const { project, rubric } = owned;
  const recoveredCriteria = await db.select().from(criteria)
    .where(eq(criteria.rubricId, rubric.id))
    .orderBy(asc(criteria.displayOrder));
  const recoveredSources = await db.select().from(sourceDocuments)
    .where(eq(sourceDocuments.projectId, project.id))
    .orderBy(asc(sourceDocuments.uploadedAt));

  return CurrentProjectResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    identity: 'account',
    current: {
      project,
      rubric,
      criteria: recoveredCriteria,
      sourceDocuments: recoveredSources,
    },
  });
}

export async function confirmProjectRubric(
  db: Database,
  projectId: string,
  input: ConfirmRubricRequest,
  userId: string | null = null,
) {
  await assertProjectAccess(db, projectId, userId);
  return db.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) notFound('Project');

    const [existingAttempt] = await tx.select({ id: attempts.id })
      .from(attempts)
      .where(eq(attempts.projectId, projectId))
      .limit(1);
    if (existingAttempt) {
      throw new ApiProblem(
        409,
        'rubric_locked',
        'This rubric cannot be replaced after practice attempts have been saved.',
      );
    }

    const confirmedAt = now();
    const [rubric] = await tx.insert(rubrics).values({
      projectId,
      sourceType: input.sourceType,
      confirmedAt,
    }).onConflictDoUpdate({
      target: rubrics.projectId,
      set: { sourceType: input.sourceType, confirmedAt },
    }).returning();
    if (!rubric) throw new Error('The rubric insert returned no row.');

    await tx.delete(criteria).where(eq(criteria.rubricId, rubric.id));
    const savedCriteria = await tx.insert(criteria).values(
      input.criteria.map((criterion) => ({ ...criterion, rubricId: rubric.id })),
    ).returning();
    await tx.update(projects).set({ updatedAt: confirmedAt }).where(eq(projects.id, projectId));

    return ConfirmRubricResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      rubric,
      criteria: savedCriteria.sort((left, right) => left.displayOrder - right.displayOrder),
    });
  });
}

export async function createPracticeAttempt(
  db: Database,
  input: CreateAttemptRequest,
  userId: string | null = null,
) {
  await assertProjectAccess(db, input.projectId, userId);
  const [rubric] = await db.select({ id: rubrics.id, confirmedAt: rubrics.confirmedAt })
    .from(rubrics)
    .where(eq(rubrics.projectId, input.projectId))
    .limit(1);
  if (!rubric?.confirmedAt) {
    throw new ApiProblem(409, 'rubric_required', 'Confirm a rubric before starting practice.');
  }

  const [criterion] = await db.select({ id: criteria.id })
    .from(criteria)
    .where(eq(criteria.rubricId, rubric.id))
    .limit(1);
  if (!criterion) {
    throw new ApiProblem(409, 'criteria_required', 'The confirmed rubric has no criteria.');
  }

  const [attempt] = await db.insert(attempts).values({
    projectId: input.projectId,
    mode: input.mode,
    status: 'draft',
    transcript: input.transcript,
    transcriptSource: input.transcriptSource,
    durationSeconds: input.durationSeconds,
  }).returning();
  if (!attempt) throw new Error('The attempt insert returned no row.');
  return CreateAttemptResponseSchema.parse({ contractVersion: CONTRACT_VERSION, attempt });
}

export async function listProjectSourceDocuments(
  db: Database,
  projectId: string,
  userId: string | null = null,
) {
  await assertProjectAccess(db, projectId, userId);
  const rows = await db.select().from(sourceDocuments)
    .where(eq(sourceDocuments.projectId, projectId))
    .orderBy(asc(sourceDocuments.uploadedAt));
  return SourceDocumentListResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    sourceDocuments: rows,
  });
}

export async function createProjectSourceDocument(
  db: Database,
  projectId: string,
  file: SourceUpload,
  userId: string | null = null,
  storage: SourceDocumentStorage = vercelSourceDocumentStorage,
) {
  await assertProjectAccess(db, projectId, userId);
  const existing = await db.select({ id: sourceDocuments.id }).from(sourceDocuments)
    .where(eq(sourceDocuments.projectId, projectId))
    .limit(MAX_SOURCE_DOCUMENTS);
  if (existing.length >= MAX_SOURCE_DOCUMENTS) {
    throw new ApiProblem(
      409,
      'source_document_limit',
      `Attach at most ${MAX_SOURCE_DOCUMENTS} source documents to one project.`,
    );
  }

  let validated: Awaited<ReturnType<typeof validateSourceUpload>>;
  try {
    validated = await validateSourceUpload(file);
  } catch (error) {
    throwSourceProblem(error);
  }

  let blobUrl: string;
  try {
    blobUrl = (await storage.put({
      projectId,
      filename: validated.filename,
      contentType: validated.contentType,
      bytes: validated.bytes,
    })).url;
  } catch (error) {
    throwSourceProblem(error);
  }

  try {
    const [sourceDocument] = await db.insert(sourceDocuments).values({
      projectId,
      blobUrl,
      filename: validated.filename,
      contentType: validated.contentType,
      sizeBytes: validated.sizeBytes,
    }).returning();
    if (!sourceDocument) throw new Error('The source-document insert returned no row.');
    return SourceDocumentUploadResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      sourceDocument,
    });
  } catch (error) {
    try {
      await storage.delete([blobUrl]);
    } catch {
      throw new ApiProblem(
        503,
        'source_document_cleanup_failed',
        'The source metadata failed to save and its private upload could not be cleaned up.',
        true,
      );
    }
    throw error;
  }
}

export async function deleteProjectSourceDocument(
  db: Database,
  projectId: string,
  sourceDocumentId: string,
  userId: string | null = null,
  storage: SourceDocumentStorage = vercelSourceDocumentStorage,
) {
  await assertProjectAccess(db, projectId, userId);
  const [sourceDocument] = await db.select().from(sourceDocuments).where(and(
    eq(sourceDocuments.id, sourceDocumentId),
    eq(sourceDocuments.projectId, projectId),
  )).limit(1);
  if (!sourceDocument) notFound('Source document');

  try {
    await storage.delete([sourceDocument.blobUrl]);
  } catch (error) {
    throwSourceProblem(error);
  }
  await db.transaction(async (tx) => {
    const affectedQuestions = await tx.select({ attemptId: questions.attemptId })
      .from(questions)
      .where(eq(questions.sourceDocumentId, sourceDocument.id));
    await tx.delete(questions).where(eq(questions.sourceDocumentId, sourceDocument.id));
    await tx.delete(sourceDocuments).where(eq(sourceDocuments.id, sourceDocument.id));
    const affectedAttemptIds = affectedQuestions.map((question) => question.attemptId);
    if (affectedAttemptIds.length > 0) {
      await tx.update(attempts).set({ status: 'review' })
        .where(inArray(attempts.id, affectedAttemptIds));
    }
  });
  return SourceDocumentDeleteResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    deleted: true,
  });
}

export async function getAttemptCriterionCount(
  db: Database,
  attemptId: string,
  userId: string | null,
): Promise<number> {
  const [attemptOwner] = await db.select({ projectId: attempts.projectId }).from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);
  if (!attemptOwner) notFound('Attempt');
  await assertProjectAccess(db, attemptOwner.projectId, userId);

  const [row] = await db.select({
    criterionCount: sql<number>`count(${criteria.id})`,
  }).from(rubrics)
    .innerJoin(criteria, eq(criteria.rubricId, rubrics.id))
    .where(and(
      eq(rubrics.projectId, attemptOwner.projectId),
      sql`${rubrics.confirmedAt} is not null`,
    ));
  const criterionCount = Number(row?.criterionCount ?? 0);
  if (!Number.isSafeInteger(criterionCount) || criterionCount < 1 || criterionCount > 20) {
    throw new ApiProblem(
      409,
      'criteria_required',
      'This attempt has no valid confirmed rubric criteria to evaluate.',
    );
  }
  return criterionCount;
}

export async function evaluateAttemptEvidence(
  db: Database,
  attemptId: string,
  options: EvidenceJudgeOptions = {},
  userId: string | null = null,
) {
  const [attempt] = await db.select().from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);
  if (!attempt) notFound('Attempt');
  const project = await assertProjectAccess(db, attempt.projectId, userId);

  const rubricRows = await db.select({ criterion: criteria })
    .from(rubrics)
    .innerJoin(criteria, eq(criteria.rubricId, rubrics.id))
    .where(eq(rubrics.projectId, attempt.projectId))
    .orderBy(asc(criteria.displayOrder));
  const criterionRows = rubricRows.map((row) => row.criterion);
  if (criterionRows.length === 0) {
    throw new ApiProblem(409, 'criteria_required', 'This attempt has no rubric criteria to evaluate.');
  }

  await db.update(attempts).set({ status: 'analysing' }).where(eq(attempts.id, attemptId));
  try {
    const judgments = await judgeEvidence(attempt.transcript, criterionRows, {
      ...options,
      language: project.language,
    });
    const reusedCitations = detectReusedCitations(judgments);
    const saved = await db.transaction(async (tx) => {
      await tx.delete(evidenceVerdicts).where(and(
        eq(evidenceVerdicts.attemptId, attemptId),
        eq(evidenceVerdicts.stage, 'initial'),
      ));
      const verdictRows = await tx.insert(evidenceVerdicts).values(judgments.map((judgment) => ({
        attemptId,
        criterionId: judgment.criterionId,
        stage: 'initial' as const,
        verdict: judgment.verdict,
        coverageScore: judgment.coverageScore,
        citedSpan: judgment.citedSpan,
        missingEvidence: judgment.missingEvidence,
        engine: judgment.engine,
        verifierAgreed: judgment.citedSpan ? true : null,
        verifierNote: null,
        studentOverridden: false,
        studentOverrideVerdict: null,
      }))).returning();
      await tx.update(attempts).set({ status: 'review' }).where(eq(attempts.id, attemptId));
      return verdictRows;
    });

    return EvidenceResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      attemptId,
      verdicts: saved,
      reusedCitations,
      degraded: judgments.some((judgment) => judgment.engine === 'deterministic'),
    });
  } catch (error) {
    await db.update(attempts).set({ status: 'failed' }).where(eq(attempts.id, attemptId));
    throw error;
  }
}

export async function confirmAttemptEvidence(
  db: Database,
  attemptId: string,
  criterionId: string,
  input: EvidenceConfirmationRequest,
  options: EvidenceJudgeOptions = {},
  userId: string | null = null,
) {
  const [context] = await db.select({
    attempt: attempts,
    criterion: criteria,
    verdict: evidenceVerdicts,
  }).from(evidenceVerdicts)
    .innerJoin(attempts, eq(attempts.id, evidenceVerdicts.attemptId))
    .innerJoin(criteria, eq(criteria.id, evidenceVerdicts.criterionId))
    .where(and(
      eq(evidenceVerdicts.attemptId, attemptId),
      eq(evidenceVerdicts.criterionId, criterionId),
      eq(evidenceVerdicts.stage, 'initial'),
    ))
    .limit(1);
  if (!context) notFound('Initial evidence verdict');
  const project = await assertProjectAccess(db, context.attempt.projectId, userId);

  const [existing] = await db.select({ id: evidenceConfirmations.id })
    .from(evidenceConfirmations)
    .where(eq(evidenceConfirmations.evidenceVerdictId, context.verdict.id))
    .limit(1);
  if (existing) {
    throw new ApiProblem(
      409,
      'evidence_already_confirmed',
      'This evidence reading already has a saved student label.',
    );
  }

  const confirmationValues = {
    evidenceVerdictId: context.verdict.id,
    accepted: input.accepted,
    judgedVerdict: context.verdict.verdict,
    judgedCoverageScore: context.verdict.coverageScore,
    judgedCitedSpan: context.verdict.citedSpan,
    judgedMissingEvidence: context.verdict.missingEvidence,
    judgedEngine: context.verdict.engine,
    rejudgedAt: null,
  };

  if (input.accepted) {
    const accepted = await db.transaction(async (tx) => {
      const [confirmation] = await tx.insert(evidenceConfirmations)
        .values(confirmationValues)
        .returning();
      if (!confirmation) throw new Error('The evidence confirmation insert returned no row.');
      if (context.verdict.verdict === 'unsupported') {
        return { confirmation, verdict: context.verdict };
      }
      const [verdict] = await tx.update(evidenceVerdicts).set({
          verdict: 'supported',
          coverageScore: 1,
          missingEvidence: [],
          studentOverridden: context.verdict.verdict !== 'supported',
          studentOverrideVerdict: context.verdict.verdict !== 'supported' ? 'supported' : null,
        }).where(eq(evidenceVerdicts.id, context.verdict.id)).returning();
      if (!verdict) throw new Error('The human-confirmed verdict update returned no row.');
      return { confirmation, verdict };
    });
    return EvidenceConfirmationResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      confirmation: accepted.confirmation,
      verdict: accepted.verdict,
      rejudged: false,
      degraded: false,
    });
  }

  // Persist the disagreement before the model call. If the provider or process
  // fails, the human label still survives and the unique key prevents a second
  // re-judge from being started for the same verdict.
  const [confirmation] = await db.insert(evidenceConfirmations)
    .values(confirmationValues)
    .returning();
  if (!confirmation) throw new Error('The evidence confirmation insert returned no row.');

  const judgment = await rejudgeCriterionAfterRejection(
    context.attempt.transcript,
    context.criterion,
    {
      verdict: context.verdict.verdict,
      coverageScore: context.verdict.coverageScore as 0 | 0.5 | 1,
      citedSpan: context.verdict.citedSpan,
      missingEvidence: context.verdict.missingEvidence,
      engine: context.verdict.engine,
    },
    { ...options, language: project.language },
  );
  const rejudgedAt = now();
  const result = await db.transaction(async (tx) => {
    const [verdict] = await tx.update(evidenceVerdicts).set({
      verdict: judgment.verdict,
      coverageScore: judgment.coverageScore,
      citedSpan: judgment.citedSpan,
      missingEvidence: judgment.missingEvidence,
      engine: judgment.engine,
      studentOverridden: true,
      studentOverrideVerdict: judgment.verdict,
      createdAt: rejudgedAt,
    }).where(eq(evidenceVerdicts.id, context.verdict.id)).returning();
    if (!verdict) throw new Error('The re-judged verdict update returned no row.');
    const [savedConfirmation] = await tx.update(evidenceConfirmations)
      .set({ rejudgedAt })
      .where(eq(evidenceConfirmations.id, confirmation.id))
      .returning();
    if (!savedConfirmation) throw new Error('The re-judge confirmation update returned no row.');
    return { verdict, confirmation: savedConfirmation };
  });

  return EvidenceConfirmationResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    confirmation: result.confirmation,
    verdict: result.verdict,
    rejudged: true,
    degraded: judgment.engine === 'deterministic',
  });
}

export async function createAttemptQuestion(
  db: Database,
  attemptId: string,
  options: QuestionGeneratorOptions = {},
  userId: string | null = null,
  storage: SourceDocumentStorage = vercelSourceDocumentStorage,
) {
  const [attemptOwner] = await db.select({ projectId: attempts.projectId }).from(attempts)
    .where(eq(attempts.id, attemptId)).limit(1);
  if (!attemptOwner) notFound('Attempt');
  const project = await assertProjectAccess(db, attemptOwner.projectId, userId);
  const candidates = await db.select({
    attempt: attempts,
    criterion: criteria,
    verdict: evidenceVerdicts,
  }).from(evidenceVerdicts)
    .innerJoin(attempts, eq(attempts.id, evidenceVerdicts.attemptId))
    .innerJoin(criteria, eq(criteria.id, evidenceVerdicts.criterionId))
    .where(and(
      eq(evidenceVerdicts.attemptId, attemptId),
      eq(evidenceVerdicts.stage, 'initial'),
    ));
  const weakest = selectWeakestCriterion(candidates);
  if (!weakest) notFound('Initial evidence review');

  const judgment = {
    criterionId: weakest.verdict.criterionId,
    verdict: weakest.verdict.verdict,
    coverageScore: weakest.verdict.coverageScore as 0 | 0.5 | 1,
    citedSpan: weakest.verdict.citedSpan,
    missingEvidence: weakest.verdict.missingEvidence,
    engine: weakest.verdict.engine,
    model: null,
    attempts: 0 as const,
    degradedReason: null,
  };
  const sourceRows = await db.select().from(sourceDocuments)
    .where(eq(sourceDocuments.projectId, weakest.attempt.projectId))
    .orderBy(asc(sourceDocuments.uploadedAt));
  let sourceMaterials: Array<{ id: string; filename: string; content: string }> = [];
  try {
    sourceMaterials = await Promise.all(sourceRows.map(async (document) => ({
      id: document.id,
      filename: document.filename,
      content: await storage.read(document.blobUrl),
    })));
  } catch (error) {
    throwSourceProblem(error);
  }
  const draft = await generateJudgeQuestion(
    weakest.attempt.transcript,
    weakest.criterion,
    judgment,
    { ...options, sourceDocuments: sourceMaterials, language: project.language },
  );
  const [question] = await db.insert(questions).values({
    attemptId,
    targetCriterionId: weakest.criterion.id,
    questionText: draft.questionText,
    challengedClaim: draft.challengedClaim,
    basis: draft.basis,
    sourceDocumentId: draft.sourceDocumentId,
  }).onConflictDoUpdate({
    target: questions.attemptId,
    set: {
      targetCriterionId: weakest.criterion.id,
      questionText: draft.questionText,
      challengedClaim: draft.challengedClaim,
      basis: draft.basis,
      sourceDocumentId: draft.sourceDocumentId,
      createdAt: now(),
    },
  }).returning();
  if (!question) throw new Error('The question insert returned no row.');
  await db.update(attempts).set({ status: 'defending' }).where(eq(attempts.id, attemptId));

  return QuestionResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    question,
    sourceDocument: draft.sourceDocumentId
      ? sourceRows.find((document) => document.id === draft.sourceDocumentId) ?? null
      : null,
    engine: draft.engine,
    model: draft.model,
    degradedReason: draft.degradedReason,
  });
}

export async function evaluateAttemptDefense(
  db: Database,
  attemptId: string,
  input: DefenseRequest,
  options: EvidenceJudgeOptions = {},
  userId: string | null = null,
) {
  const [attemptOwner] = await db.select({ projectId: attempts.projectId }).from(attempts)
    .where(eq(attempts.id, attemptId)).limit(1);
  if (!attemptOwner) notFound('Attempt');
  const project = await assertProjectAccess(db, attemptOwner.projectId, userId);
  const [context] = await db.select({ question: questions, criterion: criteria })
    .from(questions)
    .innerJoin(criteria, eq(criteria.id, questions.targetCriterionId))
    .where(eq(questions.attemptId, attemptId))
    .limit(1);
  if (!context) notFound('Judge question');

  const judgment = await judgeDefense(input.answerText, context.criterion, {
    ...options,
    language: project.language,
  });
  const result = await db.transaction(async (tx) => {
    const [answer] = await tx.insert(defenseAnswers).values({
      questionId: context.question.id,
      answerText: input.answerText,
    }).onConflictDoUpdate({
      target: defenseAnswers.questionId,
      set: { answerText: input.answerText, createdAt: now() },
    }).returning();
    if (!answer) throw new Error('The defense answer insert returned no row.');

    const [verdict] = await tx.insert(evidenceVerdicts).values({
      attemptId,
      criterionId: context.criterion.id,
      stage: 'defense',
      verdict: judgment.verdict,
      coverageScore: judgment.coverageScore,
      citedSpan: judgment.citedSpan,
      missingEvidence: judgment.missingEvidence,
      engine: judgment.engine,
      verifierAgreed: judgment.citedSpan ? true : null,
      verifierNote: null,
      studentOverridden: false,
      studentOverrideVerdict: null,
    }).onConflictDoUpdate({
      target: [
        evidenceVerdicts.attemptId,
        evidenceVerdicts.criterionId,
        evidenceVerdicts.stage,
      ],
      set: {
        verdict: judgment.verdict,
        coverageScore: judgment.coverageScore,
        citedSpan: judgment.citedSpan,
        missingEvidence: judgment.missingEvidence,
        engine: judgment.engine,
        verifierAgreed: judgment.citedSpan ? true : null,
        verifierNote: null,
        createdAt: now(),
      },
    }).returning();
    if (!verdict) throw new Error('The defense verdict insert returned no row.');
    await tx.update(attempts).set({ status: 'complete', completedAt: now() })
      .where(eq(attempts.id, attemptId));
    return { answer, verdict };
  });

  return DefenseResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    answer: result.answer,
    verdict: EvidenceVerdictSchema.parse(result.verdict),
    degraded: judgment.engine === 'deterministic',
  });
}

export async function getProjectProgress(
  db: Database,
  projectId: string,
  userId: string | null = null,
) {
  await assertProjectAccess(db, projectId, userId);

  const progress = await db.select({
    attemptId: attempts.id,
    createdAt: attempts.createdAt,
    coverage: sql<number>`coalesce(avg(${evidenceVerdicts.coverageScore}), max(${attempts.legacyEvidenceCoverage}) / 100)::float`,
  }).from(attempts)
    .leftJoin(evidenceVerdicts, and(
      eq(evidenceVerdicts.attemptId, attempts.id),
      eq(evidenceVerdicts.stage, 'initial'),
    ))
    .where(eq(attempts.projectId, projectId))
    .groupBy(attempts.id, attempts.createdAt)
    .having(sql`coalesce(avg(${evidenceVerdicts.coverageScore}), max(${attempts.legacyEvidenceCoverage}) / 100) is not null`)
    .orderBy(asc(attempts.createdAt));

  const progressAttemptIds = progress.map((point) => point.attemptId);
  const deliveryReviewRows = progressAttemptIds.length > 0
    ? await db.select({ attemptId: attemptDeliveryReviews.attemptId })
      .from(attemptDeliveryReviews)
      .where(inArray(attemptDeliveryReviews.attemptId, progressAttemptIds))
    : [];
  const recordingStatusRows = progressAttemptIds.length > 0
    ? await db.select({
      attemptId: attemptRecordings.attemptId,
      status: attemptRecordings.status,
    }).from(attemptRecordings)
      .where(inArray(attemptRecordings.attemptId, progressAttemptIds))
    : [];
  const attemptsWithDelivery = new Set(deliveryReviewRows.map((row) => row.attemptId));
  const recordingStatusByAttempt = new Map(
    recordingStatusRows.map((row) => [row.attemptId, row.status] as const),
  );
  const enrichedProgress = progress.map((point) => ({
    ...point,
    hasDeliveryReview: attemptsWithDelivery.has(point.attemptId),
    recordingStatus: recordingStatusByAttempt.get(point.attemptId) ?? null,
  }));

  const weaknessRows = await db.select({
    criterionId: criteria.id,
    criterionName: criteria.name,
    attemptCount: sql<number>`count(*)::int`,
    gapCount: sql<number>`sum(case when ${evidenceVerdicts.coverageScore} < 1 then 1 else 0 end)::int`,
    averageCoverage: sql<number>`avg(${evidenceVerdicts.coverageScore})::float`,
  }).from(evidenceVerdicts)
    .innerJoin(attempts, eq(attempts.id, evidenceVerdicts.attemptId))
    .innerJoin(criteria, eq(criteria.id, evidenceVerdicts.criterionId))
    .where(and(
      eq(attempts.projectId, projectId),
      eq(evidenceVerdicts.stage, 'initial'),
    ))
    .groupBy(criteria.id, criteria.name);

  const evidenceHistory = await db.select({
    criterionId: criteria.id,
    criterionName: criteria.name,
    attemptId: attempts.id,
    attemptCreatedAt: attempts.createdAt,
    verdict: evidenceVerdicts.verdict,
    coverage: evidenceVerdicts.coverageScore,
    citedSpan: evidenceVerdicts.citedSpan,
    missingEvidence: evidenceVerdicts.missingEvidence,
  }).from(evidenceVerdicts)
    .innerJoin(attempts, eq(attempts.id, evidenceVerdicts.attemptId))
    .innerJoin(criteria, eq(criteria.id, evidenceVerdicts.criterionId))
    .where(and(
      eq(attempts.projectId, projectId),
      eq(evidenceVerdicts.stage, 'initial'),
    ))
    .orderBy(desc(attempts.createdAt), desc(evidenceVerdicts.createdAt));
  const latestEvidence = new Map<string, typeof evidenceHistory[number]>();
  for (const row of evidenceHistory) {
    if (!latestEvidence.has(row.criterionId)) latestEvidence.set(row.criterionId, row);
  }

  const recurringWeaknesses = weaknessRows
    .filter((row) => row.gapCount >= 2)
    .map((row) => {
      const latest = latestEvidence.get(row.criterionId);
      if (!latest) throw new Error('A recurring criterion has no traceable evidence row.');
      return {
        ...row,
        latestAttemptId: latest.attemptId,
        latestAt: latest.attemptCreatedAt,
        latestCitedSpan: latest.citedSpan,
        latestMissingEvidence: latest.missingEvidence,
        summaryOnly: false,
      };
    })
    .sort((left, right) => left.averageCoverage - right.averageCoverage
      || right.gapCount - left.gapCount
      || left.criterionName.localeCompare(right.criterionName));

  const comparisonAttempts = new Map<string, {
    id: string;
    createdAt: string;
    projectId: string;
    criteria: Array<{
      criterionId: string;
      criterionName: string;
      verdict: 'supported' | 'partial' | 'unsupported';
      coverage: number;
      citedSpan: string | null;
      missingEvidence: string[];
    }>;
  }>();
  for (const row of evidenceHistory) {
    const attempt = comparisonAttempts.get(row.attemptId) ?? {
      id: row.attemptId,
      createdAt: row.attemptCreatedAt,
      projectId,
      criteria: [],
    };
    attempt.criteria.push({
      criterionId: row.criterionId,
      criterionName: row.criterionName,
      verdict: row.verdict,
      coverage: row.coverage,
      citedSpan: row.citedSpan,
      missingEvidence: row.missingEvidence,
    });
    comparisonAttempts.set(row.attemptId, attempt);
  }
  const attemptComparisons = compareAttemptEvidence([...comparisonAttempts.values()]);

  return ProgressResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    projectId,
    attempts: enrichedProgress,
    recurringWeaknesses,
    attemptComparisons,
  });
}

export async function exportOwnedWorkspace(
  db: Database,
  userId: string,
  storage: SourceDocumentStorage = vercelSourceDocumentStorage,
) {
  const projectRows = await db.select().from(projects).where(eq(projects.userId, userId));
  const projectIds = projectRows.map((project) => project.id);
  if (projectIds.length === 0) {
    return WorkspaceExportSchema.parse({
      contractVersion: CONTRACT_VERSION,
      exportedAt: now(),
      projects: [], rubrics: [], criteria: [], attempts: [], verdicts: [], questions: [],
      evidenceConfirmations: [], defenseAnswers: [], sourceDocuments: [],
      deliveryReviews: [], deliveryEvents: [], recordings: [],
    });
  }

  const rubricRows = await db.select().from(rubrics).where(inArray(rubrics.projectId, projectIds));
  const rubricIds = rubricRows.map((rubric) => rubric.id);
  const criterionRows = rubricIds.length > 0
    ? await db.select().from(criteria).where(inArray(criteria.rubricId, rubricIds))
    : [];
  const attemptRows = await db.select().from(attempts).where(inArray(attempts.projectId, projectIds));
  const attemptIds = attemptRows.map((attempt) => attempt.id);
  const verdictRows = attemptIds.length > 0
    ? await db.select().from(evidenceVerdicts).where(inArray(evidenceVerdicts.attemptId, attemptIds))
    : [];
  const verdictIds = verdictRows.map((verdict) => verdict.id);
  const confirmationRows = verdictIds.length > 0
    ? await db.select().from(evidenceConfirmations)
      .where(inArray(evidenceConfirmations.evidenceVerdictId, verdictIds))
    : [];
  const questionRows = attemptIds.length > 0
    ? await db.select().from(questions).where(inArray(questions.attemptId, attemptIds))
    : [];
  const questionIds = questionRows.map((question) => question.id);
  const answerRows = questionIds.length > 0
    ? await db.select().from(defenseAnswers).where(inArray(defenseAnswers.questionId, questionIds))
    : [];
  const deliveryReviewRows = attemptIds.length > 0
    ? await db.select().from(attemptDeliveryReviews)
      .where(inArray(attemptDeliveryReviews.attemptId, attemptIds))
    : [];
  const deliveryEventRows = attemptIds.length > 0
    ? await db.select().from(attemptDeliveryEvents)
      .where(inArray(attemptDeliveryEvents.attemptId, attemptIds))
    : [];
  // Blob references are private access coordinates, not portable user data.
  // Export the lifecycle metadata needed to understand retention without
  // exposing either the private URL or storage pathname.
  const recordingMetadataRows = attemptIds.length > 0
    ? await db.select({
      id: attemptRecordings.id,
      attemptId: attemptRecordings.attemptId,
      status: attemptRecordings.status,
      contentType: attemptRecordings.contentType,
      sizeBytes: attemptRecordings.sizeBytes,
      durationMs: attemptRecordings.durationMs,
      expiresAt: attemptRecordings.expiresAt,
      createdAt: attemptRecordings.createdAt,
      uploadedAt: attemptRecordings.uploadedAt,
    }).from(attemptRecordings)
      .where(inArray(attemptRecordings.attemptId, attemptIds))
    : [];
  const documentRows = await db.select().from(sourceDocuments)
    .where(inArray(sourceDocuments.projectId, projectIds));
  let exportedDocuments: Array<SourceDocument & { content: string }> = [];
  try {
    exportedDocuments = await Promise.all(documentRows.map(async (document) => ({
      ...SourceDocumentSchema.parse(document),
      content: await storage.read(document.blobUrl),
    })));
  } catch (error) {
    throwSourceProblem(error);
  }

  return WorkspaceExportSchema.parse({
    contractVersion: CONTRACT_VERSION,
    exportedAt: now(),
    projects: projectRows,
    rubrics: rubricRows,
    criteria: criterionRows,
    attempts: attemptRows,
    verdicts: verdictRows,
    evidenceConfirmations: confirmationRows,
    questions: questionRows,
    defenseAnswers: answerRows,
    sourceDocuments: exportedDocuments,
    deliveryReviews: deliveryReviewRows,
    deliveryEvents: deliveryEventRows,
    recordings: recordingMetadataRows,
  });
}

export async function deleteOwnedAccount(
  db: Database,
  userId: string,
  storage: SourceDocumentStorage = vercelSourceDocumentStorage,
  recordingStorage: RecordingStorage = vercelRecordingStorage,
) {
  const ownedSources = await db.select({ blobUrl: sourceDocuments.blobUrl })
    .from(sourceDocuments)
    .innerJoin(projects, eq(projects.id, sourceDocuments.projectId))
    .where(eq(projects.userId, userId));
  const ownedRecordings = await db.select({
    blobUrl: attemptRecordings.blobUrl,
    pathname: attemptRecordings.pathname,
  })
    .from(attemptRecordings)
    .innerJoin(attempts, eq(attempts.id, attemptRecordings.attemptId))
    .innerJoin(projects, eq(projects.id, attempts.projectId))
    .where(eq(projects.userId, userId));
  try {
    await recordingStorage.delete(ownedRecordings.map((recording) => (
      recording.blobUrl ?? recording.pathname
    )));
  } catch {
    throw new ApiProblem(
      503,
      'recording_storage_unavailable',
      'Private recording storage could not complete account deletion.',
      true,
    );
  }
  try {
    await storage.delete(ownedSources.map((source) => source.blobUrl));
  } catch (error) {
    throwSourceProblem(error);
  }
  const deleted = await db.delete(user).where(eq(user.id, userId)).returning({ id: user.id });
  if (deleted.length !== 1) notFound('Account');
  return { contractVersion: CONTRACT_VERSION, deleted: true as const };
}

type LegacyWorkspaceImport = z.infer<typeof LegacyWorkspaceImportSchema>;

export async function importLegacyWorkspace(
  db: Database,
  userId: string,
  workspace: LegacyWorkspaceImport,
) {
  return db.transaction(async (tx) => {
    const projectMap = new Map<string, { id: string; duration: number }>();
    for (const legacyProject of workspace.projects) {
      const [project] = await tx.insert(projects).values({
        userId,
        title: legacyProject.name,
        eventContext: legacyProject.event || null,
        deadline: legacyProject.deadline ?? null,
        createdAt: legacyProject.createdAt,
        updatedAt: legacyProject.createdAt,
      }).returning();
      if (!project) throw new Error('A legacy project insert returned no row.');
      const [rubric] = await tx.insert(rubrics).values({
        projectId: project.id,
        sourceType: 'imported',
        confirmedAt: now(),
        createdAt: legacyProject.createdAt,
      }).returning();
      if (!rubric) throw new Error('A legacy rubric insert returned no row.');
      const parsedCriteria = parseRubric(legacyProject.rubric);
      await tx.insert(criteria).values(parsedCriteria.map((criterion, displayOrder) => ({
        rubricId: rubric.id,
        name: criterion.label,
        description: criterion.requirementText,
        requiredEvidence: criterion.signals,
        displayOrder,
      })));
      projectMap.set(legacyProject.id, { id: project.id, duration: legacyProject.draftDuration });
    }

    let importedSessions = 0;
    for (const legacySession of workspace.sessions) {
      const project = projectMap.get(legacySession.projectId);
      if (!project) continue;
      // The v1 browser snapshot retained only summary metadata, not the old
      // transcript or evidence spans. Preserve a real attempt record but do
      // not fabricate verdict rows the source cannot support.
      await tx.insert(attempts).values({
        projectId: project.id,
        mode: 'typed',
        status: 'complete',
        transcript: '',
        transcriptSource: 'imported',
        durationSeconds: project.duration,
        legacyTitle: legacySession.title,
        legacyEvidenceCoverage: legacySession.evidenceScore,
        legacyWeakest: legacySession.weakest,
        legacyDefenseStatus: legacySession.defenseStatus,
        createdAt: legacySession.createdAt,
        completedAt: legacySession.createdAt,
      });
      importedSessions += 1;
    }

    return LegacyImportResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      importedProjects: projectMap.size,
      importedSessions,
      sourceRetained: true,
    });
  });
}
