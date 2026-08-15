import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CreateProjectRequestSchema,
  CreateProjectResponseSchema,
  CurrentProjectResponseSchema,
  LegacyWorkspaceImportSchema,
  ProjectListResponseSchema,
  ProjectSchema,
  ProjectWorkspaceResponseSchema,
  UpdateProjectRequestSchema,
  UpdateProjectResponseSchema,
  WorkspaceExportSchema,
} from '../apps/web/lib/contracts.ts';
import {
  LOCAL_PROJECT_LANGUAGE_KEY,
  readLocalProjectLanguage,
  writeLocalProjectLanguage,
} from '../apps/web/lib/project-preferences.ts';
import { generateJudgeQuestion } from '../apps/web/lib/ai/question-generator.ts';
import { statelessAnalysisCacheKey } from '../apps/web/lib/api/stateless-analysis-cache.ts';

const project = {
  id: 'project-1',
  userId: null,
  title: 'Final rehearsal',
  eventContext: null,
  deadline: null,
  createdAt: '2026-08-13T08:00:00.000Z',
  updatedAt: '2026-08-13T08:00:00.000Z',
};

test('older project responses gain the explicit Indonesian default', () => {
  assert.equal(ProjectSchema.parse(project).language, 'id-ID');
  assert.equal(ProjectSchema.parse({ ...project, language: 'en-US' }).language, 'en-US');
  assert.equal(CreateProjectRequestSchema.parse({ title: 'Pitch' }).language, 'id-ID');

  assert.equal(CreateProjectResponseSchema.parse({
    contractVersion: 2,
    project,
  }).project.language, 'id-ID');
  assert.equal(UpdateProjectResponseSchema.parse({
    contractVersion: 2,
    project,
  }).project.language, 'id-ID');
  assert.equal(ProjectListResponseSchema.parse({
    contractVersion: 2,
    identity: 'account',
    projects: [{
      project,
      attemptCount: 0,
      lastAttemptAt: null,
      rubricConfirmed: false,
    }],
  }).projects[0].project.language, 'id-ID');
  assert.equal(CurrentProjectResponseSchema.parse({
    contractVersion: 2,
    identity: 'account',
    current: {
      project,
      rubric: null,
      criteria: [],
      sourceDocuments: [],
    },
  }).current?.project.language, 'id-ID');
  assert.equal(ProjectWorkspaceResponseSchema.parse({
    contractVersion: 2,
    workspace: {
      project,
      rubric: null,
      criteria: [],
      sourceDocuments: [],
    },
  }).workspace.project.language, 'id-ID');

  assert.equal(WorkspaceExportSchema.parse({
    contractVersion: 2,
    exportedAt: '2026-08-13T09:00:00.000Z',
    projects: [project],
    rubrics: [],
    criteria: [],
    attempts: [],
    verdicts: [],
    evidenceConfirmations: [],
    questions: [],
    defenseAnswers: [],
    sourceDocuments: [],
    deliveryReviews: [],
    deliveryEvents: [],
    recordings: [],
  }).projects[0].language, 'id-ID');

  assert.equal(LegacyWorkspaceImportSchema.safeParse({
    version: 1,
    projects: [{
      id: 'legacy-project',
      name: 'Older local pitch',
      event: 'Finals',
      rubric: 'Impact | observed outcome',
      draft: '',
      draftDuration: 420,
      createdAt: '2026-08-12T09:00:00.000Z',
    }],
    sessions: [],
  }).success, true, 'v1 local workspaces did not store a language and must remain importable');
});

test('project language updates are deliberately narrow', () => {
  assert.deepEqual(UpdateProjectRequestSchema.parse({ language: 'en-US' }), { language: 'en-US' });
  assert.equal(UpdateProjectRequestSchema.safeParse({ language: 'fr-FR' }).success, false);
  assert.equal(UpdateProjectRequestSchema.safeParse({ language: 'id-id' }).success, false);
  assert.equal(UpdateProjectRequestSchema.safeParse({ language: null }).success, false);
  assert.equal(UpdateProjectRequestSchema.safeParse({}).success, false);
  assert.equal(UpdateProjectRequestSchema.safeParse({ language: 'id-ID', title: 'rename' }).success, false);
});

test('the local workspace keeps one project language with a fail-safe default', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readLocalProjectLanguage(storage), 'id-ID');
  assert.equal(writeLocalProjectLanguage(storage, 'en-US'), 'en-US');
  assert.equal(values.get(LOCAL_PROJECT_LANGUAGE_KEY), 'en-US');
  values.set(LOCAL_PROJECT_LANGUAGE_KEY, 'not-a-locale');
  assert.equal(readLocalProjectLanguage(storage), 'id-ID');

  const blockedStorage = {
    getItem: () => { throw new Error('storage blocked'); },
    setItem: () => { throw new Error('storage blocked'); },
  };
  assert.equal(readLocalProjectLanguage(blockedStorage), 'id-ID');
  assert.equal(writeLocalProjectLanguage(blockedStorage, 'en-US'), 'en-US');
});

test('language is persisted and owner-checked across the project boundary', () => {
  const schema = readFileSync(new URL('../apps/web/lib/db/schema.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../apps/web/drizzle/0008_flat_frank_castle.sql', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../apps/web/lib/services/workspace.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../apps/web/app/api/projects/[id]/route.ts', import.meta.url), 'utf8');

  assert.match(schema, /projectLanguage\('language'\)\.default\('id-ID'\)\.notNull/u);
  assert.match(migration, /CREATE TYPE "public"\."project_language" AS ENUM\('id-ID', 'en-US'\)/u);
  assert.match(migration, /ADD COLUMN "language" "project_language" DEFAULT 'id-ID' NOT NULL/u);
  assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE/u);
  assert.match(service, /eq\(projects\.id, projectId\),\s+eq\(projects\.userId, userId\)/u);
  assert.match(service, /language: input\.language/u);
  assert.match(service, /ProjectWorkspaceResponseSchema\.parse/u);
  assert.match(service, /UpdateProjectResponseSchema\.parse/u);
  assert.match(service, /set\(\{ language: input\.language/u);
  assert.match(service, /orderBy\(desc\(projects\.updatedAt\), desc\(projects\.createdAt\)\)[\s\S]+\.limit\(100\)/u);
  assert.match(route, /requireUserId\(request\)/u);
  assert.match(route, /UpdateProjectRequestSchema/u);
  assert.ok(
    route.indexOf('requireUserId(request)') < route.indexOf('z.uuid().parse(rawId)'),
    'authentication must run before project-id validation',
  );
  assert.ok(
    route.lastIndexOf('requireUserId(request)') < route.indexOf('parseJson(request, UpdateProjectRequestSchema)'),
    'PATCH authentication must run before request-body validation',
  );
});

test('the generated migration metadata forms one intact, locale-aware chain', () => {
  const previous = JSON.parse(readFileSync(
    new URL('../apps/web/drizzle/meta/0007_snapshot.json', import.meta.url),
    'utf8',
  ));
  const snapshot = JSON.parse(readFileSync(
    new URL('../apps/web/drizzle/meta/0008_snapshot.json', import.meta.url),
    'utf8',
  ));
  const journal = JSON.parse(readFileSync(
    new URL('../apps/web/drizzle/meta/_journal.json', import.meta.url),
    'utf8',
  ));
  const lastEntry = journal.entries.at(-1);

  assert.equal(snapshot.prevId, previous.id);
  assert.equal(lastEntry?.idx, 8);
  assert.equal(lastEntry?.tag, '0008_flat_frank_castle');
  assert.deepEqual(snapshot.enums['public.project_language'].values, ['id-ID', 'en-US']);
  assert.deepEqual(snapshot.tables['public.projects'].columns.language, {
    name: 'language',
    type: 'project_language',
    typeSchema: 'public',
    primaryKey: false,
    notNull: true,
    default: "'id-ID'",
  });
});

// The semantic path composes its visible question in application code too
// (question-generator.ts says so in its own system prompt: "Application code,
// not you, writes the visible question"). So the language of what a student
// reads is our decision on every path, semantic and deterministic alike, and
// it has to follow the project rather than the file the template lives in.
test('the composed judge question follows the project language on the deterministic path', async () => {
  const criterion = {
    id: 'validasi',
    rubricId: 'rubric-1',
    name: 'Validasi',
    description: 'Bukti pengujian bersama pengguna',
    requiredEvidence: ['jumlah pengguna yang diuji'],
    displayOrder: 0,
  };
  const judgment = {
    criterionId: 'validasi',
    verdict: 'unsupported',
    coverageScore: 0,
    citedSpan: null,
    missingEvidence: ['jumlah pengguna yang diuji'],
    engine: 'deterministic',
    degradedReason: null,
  };

  const indonesian = await generateJudgeQuestion('transkrip latihan', criterion, judgment, {
    model: '',
    language: 'id-ID',
  });
  const english = await generateJudgeQuestion('transkrip latihan', criterion, judgment, {
    model: '',
    language: 'en-US',
  });

  assert.match(indonesian.questionText, /^Bukti eksplisit apa yang bisa Anda tambahkan/u);
  assert.match(english.questionText, /^What explicit evidence can you add/u);
  // The cue itself is the student's own rubric text and is never translated.
  assert.ok(indonesian.questionText.includes('jumlah pengguna yang diuji'));
  assert.ok(english.questionText.includes('jumlah pengguna yang diuji'));
});

test('an unset question language uses the same id-ID default as the project contract', async () => {
  const draft = await generateJudgeQuestion(
    'transkrip latihan',
    {
      id: 'validasi',
      rubricId: 'rubric-1',
      name: 'Validasi',
      description: 'Bukti pengujian',
      requiredEvidence: ['jumlah pengguna'],
      displayOrder: 0,
    },
    {
      criterionId: 'validasi',
      verdict: 'unsupported',
      coverageScore: 0,
      citedSpan: null,
      missingEvidence: ['jumlah pengguna'],
      engine: 'deterministic',
      degradedReason: null,
    },
    { model: '' },
  );
  assert.match(draft.questionText, /^Bukti eksplisit apa/u);
});

// The cached response now depends on the language, because judgeQuestion,
// drill and missingEvidence all do. The key already covers the system prompts,
// but the language directive rides in the user prompt, so nothing would have
// invalidated it. Two projects sharing a transcript and rubric would otherwise
// serve each other's wording.
test('the analysis cache key separates two projects that differ only in language', () => {
  const shared = {
    transcript: 'Kami menguji prototipe ini bersama dua belas mahasiswa.',
    criteria: [{
      id: 'validasi',
      name: 'Validasi',
      description: 'Bukti pengujian',
      requiredEvidence: ['jumlah pengguna'],
      displayOrder: 0,
    }],
  };
  assert.notEqual(
    statelessAnalysisCacheKey({ ...shared, language: 'id-ID' }, {}),
    statelessAnalysisCacheKey({ ...shared, language: 'en-US' }, {}),
  );
});
