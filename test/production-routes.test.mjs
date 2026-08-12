import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  ConfirmRubricRequestSchema,
  CurrentProjectResponseSchema,
  EvidenceVerdictSchema,
  EvidenceConfirmationRequestSchema,
  EvidenceConfirmationResponseSchema,
  QuestionResponseSchema,
  SourceDocumentUploadResponseSchema,
  StatelessAnalysisRequestSchema,
  StatelessAnalysisResponseSchema,
} from '../apps/web/lib/contracts.ts';

const routeFiles = [
  'apps/web/app/api/analyze/route.ts',
  'apps/web/app/api/rejudge/route.ts',
  'apps/web/app/api/defend/route.ts',
  'apps/web/app/api/rubrics/parse/route.ts',
  'apps/web/app/api/projects/route.ts',
  'apps/web/app/api/projects/current/route.ts',
  'apps/web/app/api/projects/[id]/rubric/route.ts',
  'apps/web/app/api/projects/[id]/sources/route.ts',
  'apps/web/app/api/projects/[id]/sources/[sourceId]/route.ts',
  'apps/web/app/api/attempts/route.ts',
  'apps/web/app/api/attempts/[id]/evidence/route.ts',
  'apps/web/app/api/attempts/[id]/evidence/[criterionId]/confirmation/route.ts',
  'apps/web/app/api/attempts/[id]/question/route.ts',
  'apps/web/app/api/attempts/[id]/defense/route.ts',
  'apps/web/app/api/progress/[projectId]/route.ts',
];

test('M-9 exposes every target route behind the typed error boundary', async () => {
  for (const routeFile of routeFiles) {
    const source = await readFile(routeFile, 'utf8');
    assert.match(source, /withApiErrors/gu, `${routeFile} must use the shared error boundary`);
    assert.doesNotMatch(source, /runtime\s*=\s*['"]edge['"]/gu, `${routeFile} must not use Edge`);
  }
});

test('A-7 rate-limits every paid route before its model-backed service call', async () => {
  const paidRoutes = new Map([
    ['apps/web/app/api/analyze/route.ts', 'analysis'],
    ['apps/web/app/api/rejudge/route.ts', 'confirmation'],
    ['apps/web/app/api/defend/route.ts', 'defense'],
    ['apps/web/app/api/rubrics/parse/route.ts', 'rubric'],
    ['apps/web/app/api/attempts/[id]/evidence/route.ts', 'evidence'],
    ['apps/web/app/api/attempts/[id]/question/route.ts', 'question'],
    ['apps/web/app/api/attempts/[id]/defense/route.ts', 'defense'],
    ['apps/web/app/api/attempts/[id]/evidence/[criterionId]/confirmation/route.ts', 'confirmation'],
  ]);
  for (const [routeFile, scope] of paidRoutes) {
    const source = await readFile(routeFile, 'utf8');
    assert.match(source, /enforceAiRateLimit/gu, `${routeFile} has no cost-control boundary`);
    assert.match(source, new RegExp(`enforceAiRateLimit\\(request, '${scope}'`, 'u'));
  }
  const confirmation = await readFile(
    'apps/web/app/api/attempts/[id]/evidence/[criterionId]/confirmation/route.ts',
    'utf8',
  );
  assert.match(confirmation, /if \(!input\.accepted\) await enforceAiRateLimit/u);
});

test('A-6 source upload and question provenance stay contract-bound', () => {
  const sourceDocument = {
    id: 'source-1',
    projectId: 'project-1',
    blobUrl: 'https://private.example.test/source-1',
    filename: 'proposal.md',
    contentType: 'text/markdown',
    sizeBytes: 128,
    uploadedAt: '2026-08-12T08:00:00.000Z',
  };
  assert.equal(SourceDocumentUploadResponseSchema.safeParse({
    contractVersion: 2,
    sourceDocument,
  }).success, true);
  const response = {
    contractVersion: 2,
    question: {
      id: 'question-1',
      attemptId: 'attempt-1',
      targetCriterionId: 'criterion-1',
      questionText: 'How does the cited interview evidence support this differentiation claim?',
      challengedClaim: 'Interview evidence shows students receive feedback only after submission.',
      basis: 'source-document',
      sourceDocumentId: sourceDocument.id,
      createdAt: '2026-08-12T08:00:01.000Z',
    },
    sourceDocument,
    engine: 'deterministic',
    model: null,
    degradedReason: 'Semantic question generation is not configured.',
  };
  assert.equal(QuestionResponseSchema.safeParse(response).success, true);
  assert.equal(QuestionResponseSchema.safeParse({ ...response, sourceDocument: null }).success, false);
  assert.equal(QuestionResponseSchema.safeParse({
    ...response,
    sourceDocument: { ...sourceDocument, id: 'source-2' },
  }).success, false);
});

test('A-5 confirmation contract records one explicit label and its persisted re-judge state', () => {
  assert.equal(EvidenceConfirmationRequestSchema.safeParse({ accepted: false }).success, true);
  assert.equal(EvidenceConfirmationRequestSchema.safeParse({ accepted: 'no' }).success, false);

  const invalid = EvidenceConfirmationResponseSchema.safeParse({
    contractVersion: 2,
    confirmation: {
      id: 'confirmation-1',
      evidenceVerdictId: 'verdict-1',
      accepted: false,
      judgedVerdict: 'supported',
      judgedCoverageScore: 1,
      judgedCitedSpan: 'A grounded span that the student rejected.',
      judgedMissingEvidence: [],
      judgedEngine: 'semantic',
      createdAt: '2026-08-12T08:00:00.000Z',
      rejudgedAt: null,
    },
    verdict: {
      id: 'verdict-1', attemptId: 'attempt-1', criterionId: 'criterion-1', stage: 'initial',
      verdict: 'unsupported', coverageScore: 0, citedSpan: null,
      missingEvidence: ['different evidence'], engine: 'semantic', verifierAgreed: null,
      verifierNote: null, studentOverridden: true, studentOverrideVerdict: 'unsupported',
      createdAt: '2026-08-12T08:00:01.000Z',
    },
    rejudged: true,
    degraded: false,
  });
  assert.equal(invalid.success, false, 'a rejection cannot claim re-judging without its persisted timestamp');
});

test('M-9 rejects duplicate criterion order before persistence', () => {
  const result = ConfirmRubricRequestSchema.safeParse({
    sourceType: 'manual',
    criteria: [
      { name: 'Problem', description: '', requiredEvidence: [], displayOrder: 0 },
      { name: 'Solution', description: '', requiredEvidence: [], displayOrder: 0 },
    ],
  });
  assert.equal(result.success, false);
});

test('M-9 recovers only one identity-owned project with its rubric and source metadata', async () => {
  const timestamp = '2026-08-12T08:00:00.000Z';
  const project = {
    id: 'project-1', userId: 'user-1', title: 'Finals rehearsal',
    eventContext: '7-minute pitch', deadline: '2026-08-14',
    createdAt: timestamp, updatedAt: timestamp,
  };
  const rubric = {
    id: 'rubric-1', projectId: project.id, sourceType: 'imported',
    confirmedAt: timestamp, createdAt: timestamp,
  };
  const criterion = {
    id: 'criterion-1', rubricId: rubric.id, name: 'Impact', description: 'Show impact.',
    requiredEvidence: ['measured outcome'], displayOrder: 0,
  };
  const sourceDocument = {
    id: 'source-1', projectId: project.id, blobUrl: 'https://private.example/source-1',
    filename: 'proposal.md', contentType: 'text/markdown', sizeBytes: 128,
    uploadedAt: timestamp,
  };
  assert.equal(CurrentProjectResponseSchema.safeParse({
    contractVersion: 2,
    identity: 'account',
    current: { project, rubric, criteria: [criterion], sourceDocuments: [sourceDocument] },
  }).success, true);
  assert.equal(CurrentProjectResponseSchema.safeParse({
    contractVersion: 2,
    identity: 'guest',
    current: { project, rubric, criteria: [criterion], sourceDocuments: [sourceDocument] },
  }).success, false, 'an anonymous identity must never receive a SQL project');
  assert.equal(CurrentProjectResponseSchema.safeParse({
    contractVersion: 2,
    identity: 'account',
    current: {
      project,
      rubric,
      criteria: [criterion],
      sourceDocuments: [{ ...sourceDocument, projectId: 'another-project' }],
    },
  }).success, false, 'source metadata cannot cross the recovered project boundary');

  const capabilities = await readFile('apps/web/app/api/capabilities/route.ts', 'utf8');
  assert.match(capabilities, /persistence: databaseAvailable && userId \? 'neon' : 'local'/u);
  assert.match(capabilities, /sourceDocuments:[\s\S]+databaseAvailable && userId/u);
  const service = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  assert.match(service, /getCurrentOwnedProject[\s\S]+if \(!userId\)[\s\S]+identity: 'guest'[\s\S]+current: null/gu);
  assert.match(service, /innerJoin\(rubrics[\s\S]+rubrics\.confirmedAt[\s\S]+where\(eq\(projects\.userId, userId\)\)[\s\S]+orderBy\(desc\(projects\.updatedAt\)/gu);
  assert.match(service, /recoveredCriteria[\s\S]+asc\(criteria\.displayOrder\)[\s\S]+recoveredSources/gu);
});

test('M-9 persistent project routes reject anonymous SQL ownership', async () => {
  const privateRoutes = routeFiles.filter((routeFile) => (
    routeFile.includes('/projects/')
    || routeFile.endsWith('/projects/route.ts')
    || routeFile.includes('/attempts/')
    || routeFile.endsWith('/attempts/route.ts')
    || routeFile.includes('/progress/')
  )).filter((routeFile) => !routeFile.endsWith('/projects/current/route.ts'));
  for (const routeFile of privateRoutes) {
    const source = await readFile(routeFile, 'utf8');
    assert.match(source, /requireUserId/u, `${routeFile} must require a synced account identity`);
    assert.doesNotMatch(source, /optionalUserId/u, `${routeFile} accepts an anonymous SQL identity`);
  }
  const service = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  assert.match(service, /async function assertProjectAccess[\s\S]+if \(!userId\)[\s\S]+authentication_required/gu);
  assert.match(service, /getAttemptCriterionCount[\s\S]+assertProjectAccess[\s\S]+count\(\$\{criteria\.id\}\)[\s\S]+rubrics\.confirmedAt/gu);
});

test('A-1 stateless contracts reject duplicate ids, duplicate order, and contradictory support', () => {
  const criterion = {
    id: 'impact', name: 'Impact', description: 'Show an observed outcome.',
    requiredEvidence: ['beneficiary', 'outcome'], displayOrder: 0,
  };
  assert.equal(StatelessAnalysisRequestSchema.safeParse({
    transcript: 'A sufficiently explicit attempt.',
    durationSeconds: 60,
    criteria: [criterion, { ...criterion }],
  }).success, false);

  const row = {
    id: 'impact', label: 'Impact', requirementText: 'Show an outcome.',
    signals: ['beneficiary'], score: 100, status: 'covered',
    matchedSignals: ['beneficiary'], missingSignals: ['outcome'], excerpt: 'A beneficiary outcome.',
  };
  assert.equal(StatelessAnalysisResponseSchema.safeParse({
    contractVersion: 2,
    analysis: {
      evidenceScore: 100, coveredCount: 1, criterionCount: 1,
      criteria: [row], weakest: row, judgeQuestion: 'What is the observed outcome?',
      drill: 'State the outcome.',
      delivery: { wordCount: 3, durationSeconds: 60, wordsPerMinute: 3, pace: 'deliberate', fillerCount: 0, fillers: [] },
    },
    mode: 'semantic',
    criterionEngines: [{ criterionId: 'impact', engine: 'semantic' }],
    reusedCitations: [], questionEngine: 'semantic', cached: false,
  }).success, false);
});

test('M-9 requires partial verdicts to retain traceable evidence', () => {
  const result = EvidenceVerdictSchema.safeParse({
    id: 'verdict-1',
    attemptId: 'attempt-1',
    criterionId: 'criterion-1',
    stage: 'initial',
    verdict: 'partial',
    coverageScore: 0.5,
    citedSpan: null,
    missingEvidence: ['A measured result'],
    engine: 'semantic',
    verifierAgreed: null,
    verifierNote: null,
    studentOverridden: false,
    studentOverrideVerdict: null,
    createdAt: '2026-08-12T08:00:00.000Z',
  });
  assert.equal(result.success, false);
});

test('M-9 keeps multi-row writes atomic and progress free of model calls', async () => {
  const source = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  assert.match(source, /confirmProjectRubric[\s\S]+db\.transaction/gu);
  assert.match(source, /confirmAttemptEvidence[\s\S]+rejudgeCriterionAfterRejection/gu);
  assert.match(source, /evidence_already_confirmed/gu);
  assert.match(source, /if \(input\.accepted\)[\s\S]+db\.transaction[\s\S]+coverageScore: 1/gu);
  assert.match(source, /Persist the disagreement before the model call/gu);
  assert.match(source, /evaluateAttemptDefense[\s\S]+db\.transaction/gu);
  assert.match(source, /createProjectSourceDocument[\s\S]+storage\.put[\s\S]+insert\(sourceDocuments\)/gu);
  assert.match(source, /deleteProjectSourceDocument[\s\S]+storage\.delete[\s\S]+db\.transaction/gu);
  assert.match(source, /createAttemptQuestion[\s\S]+storage\.read[\s\S]+sourceDocuments: sourceMaterials/gu);

  const progressSource = source.slice(source.indexOf('export async function getProjectProgress'));
  assert.doesNotMatch(progressSource, /judgeEvidence|generateJudgeQuestion|judgeDefense/gu);
  assert.match(progressSource, /avg\(/gu);
});

test('M-9 pooled Neon adapter supports the transactions the service requires', async () => {
  const source = await readFile('apps/web/lib/db/client.ts', 'utf8');
  assert.match(source, /drizzle-orm\/neon-serverless/gu);
  assert.doesNotMatch(source, /drizzle-orm\/neon-http/gu);
});

test('A-7 shared error boundary preserves rate-limit response headers', async () => {
  const source = await readFile('apps/web/lib/api/http.ts', 'utf8');
  assert.match(source, /NextResponse\.json\(payload, \{ status: problem\.status, headers: problem\.headers \}\)/u);
});
