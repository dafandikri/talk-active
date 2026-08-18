import { expect, test, type Page, type Route } from '@playwright/test';

const CREATED = '2026-08-13T08:00:00.000Z';
const PITCH_PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const THESIS_PROJECT_ID = '66666666-6666-4666-8666-666666666666';

function project(
  id: string,
  title: string,
  language: 'id-ID' | 'en-US',
  attemptCount = 0,
) {
  return {
    project: {
      id,
      userId: 'rubric-owner',
      title,
      language,
      eventContext: 'Live evaluation',
      deadline: '2026-08-14',
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    attemptCount,
    lastAttemptAt: attemptCount > 0 ? CREATED : null,
    rubricConfirmed: true,
  };
}

const pitchProject = project(PITCH_PROJECT_ID, 'English product pitch', 'en-US');
const thesisProject = project(THESIS_PROJECT_ID, 'Sidang skripsi Indonesia', 'id-ID');

function workspace(
  summary: ReturnType<typeof project>,
  sourceType: 'manual' | 'imported' | 'library',
  rows: Array<{ name: string; description: string; evidence: string[] }>,
) {
  const rubricId = `${summary.project.id}:rubric`;
  return {
    project: summary.project,
    rubric: {
      id: rubricId,
      projectId: summary.project.id,
      sourceType,
      confirmedAt: CREATED,
      createdAt: CREATED,
    },
    criteria: rows.map((row, displayOrder) => ({
      id: `${summary.project.id}:criterion:${displayOrder}`,
      rubricId,
      name: row.name,
      description: row.description,
      requiredEvidence: row.evidence,
      displayOrder,
    })),
    sourceDocuments: [],
  };
}

const pitchWorkspace = workspace(pitchProject, 'manual', [
  {
    name: 'Verified customer impact',
    description: 'Name the observed customer outcome.',
    evidence: ['named customer', 'measured outcome'],
  },
  {
    name: 'Working demo path',
    description: 'Show the live path and recovery boundary.',
    evidence: ['live interaction', 'fallback'],
  },
]);

const thesisWorkspace = workspace(thesisProject, 'imported', [
  {
    name: 'Research method fit',
    description: 'Connect the research question to the selected method.',
    evidence: ['research question', 'sampling rationale'],
  },
  {
    name: 'Defensible findings',
    description: 'Separate observed findings from interpretation.',
    evidence: ['named finding', 'study limitation'],
  },
]);

function respond(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function errorBody(message: string) {
  return {
    contractVersion: 2,
    error: { code: 'project_unavailable', message, retryable: true },
  };
}

async function seedBrowserGlobalTrap(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('talkactive.production.rubric.v2', JSON.stringify({
      version: 2,
      criteria: [{
        id: 'browser-global-trap',
        name: 'Browser-global trap',
        description: 'This row must never render for a synced project.',
        requiredEvidence: ['wrong owner'],
        sourceExcerpt: null,
        displayOrder: 0,
      }],
    }));
  });
}

interface MockOptions {
  projects?: Array<ReturnType<typeof project>>;
  projectResponder?: (route: Route, projectId: string) => Promise<void>;
  onRubricPut?: (route: Route, projectId: string) => Promise<void>;
}

async function mockAccount(page: Page, options: MockOptions = {}) {
  const projects = options.projects ?? [pitchProject, thesisProject];
  const workspaces = new Map([
    [PITCH_PROJECT_ID, pitchWorkspace],
    [THESIS_PROJECT_ID, thesisWorkspace],
  ]);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/capabilities') {
      return respond(route, {
        contractVersion: 2,
        persistence: 'neon',
        accounts: true,
        sourceDocuments: false,
        recordings: false,
        semantic: { rubric: false, evidence: false, question: false, defense: false, coach: false },
      });
    }
    if (url.pathname === '/api/projects') {
      return respond(route, { contractVersion: 2, identity: 'account', projects });
    }
    const rubricMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/rubric$/u);
    if (rubricMatch?.[1] && request.method() === 'PUT') {
      if (options.onRubricPut) return options.onRubricPut(route, rubricMatch[1]);
    }
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/u);
    if (projectMatch?.[1]) {
      if (options.projectResponder) return options.projectResponder(route, projectMatch[1]);
      const selected = workspaces.get(projectMatch[1]);
      if (selected) return respond(route, { contractVersion: 2, workspace: selected });
    }
    return respond(route, errorBody('The test did not configure this API request.'), 404);
  });
}

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin !== 'http://127.0.0.1:4183') {
      externalRequests.push(request.url());
    }
  });
  (page as typeof page & { consoleErrors?: string[] }).consoleErrors = consoleErrors;
  (page as typeof page & { externalRequests?: string[] }).externalRequests = externalRequests;
});

test.afterEach(async ({ page }) => {
  expect((page as typeof page & { consoleErrors?: string[] }).consoleErrors ?? []).toEqual([]);
  expect((page as typeof page & { externalRequests?: string[] }).externalRequests ?? []).toEqual([]);
});

test('deep link, project switch, browser Back, and Save keep one owner-scoped rubric together', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrowserGlobalTrap(page);
  let releaseThesis!: () => void;
  const thesisGate = new Promise<void>((resolve) => { releaseThesis = resolve; });
  const rubricPuts: Array<{ projectId: string; body: Record<string, unknown> }> = [];

  await mockAccount(page, {
    projectResponder: async (route, projectId) => {
      if (projectId === THESIS_PROJECT_ID) await thesisGate;
      const selected = projectId === THESIS_PROJECT_ID ? thesisWorkspace : pitchWorkspace;
      await respond(route, { contractVersion: 2, workspace: selected });
    },
    onRubricPut: async (route, projectId) => {
      const body = route.request().postDataJSON() as {
        sourceType: 'manual' | 'imported' | 'library';
        criteria: Array<{
          name: string;
          description: string;
          requiredEvidence: string[];
          displayOrder: number;
        }>;
      };
      rubricPuts.push({ projectId, body });
      const rubricId = `${projectId}:saved-rubric`;
      await respond(route, {
        contractVersion: 2,
        rubric: {
          id: rubricId,
          projectId,
          sourceType: body.sourceType,
          confirmedAt: CREATED,
          createdAt: CREATED,
        },
        criteria: body.criteria.map((criterion, index) => ({
          ...criterion,
          id: `${projectId}:saved:${index}`,
          rubricId,
        })),
      });
    },
  });

  await page.goto(`/rubric?project=${THESIS_PROJECT_ID}`);
  await expect(page.locator('.surface[role="status"]')).toContainText('Loading Sidang skripsi Indonesia');
  await expect(page.getByText('Browser-global trap')).toHaveCount(0);
  releaseThesis();

  await expect(page.getByRole('heading', { name: 'Sidang skripsi Indonesia', exact: true })).toBeVisible();
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Research method fit');
  await expect(page.getByLabel('Kriteria').nth(1)).toHaveValue('Defensible findings');
  await expect(page.getByLabel('Isyarat bukti yang teramati').first())
    .toHaveValue('research question, sampling rationale');
  await expect(page.getByLabel('Isyarat bukti yang teramati').nth(1))
    .toHaveValue('named finding, study limitation');
  await expect(page.getByText('Browser-global trap')).toHaveCount(0);

  await page.getByLabel('Proyek').selectOption(PITCH_PROJECT_ID);
  await expect(page).toHaveURL(`/rubric?project=${PITCH_PROJECT_ID}`);
  await expect(page.getByRole('heading', { name: 'English product pitch', exact: true })).toBeVisible();
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Verified customer impact');
  await expect(page.getByLabel('Kriteria').nth(1)).toHaveValue('Working demo path');

  await page.goBack();
  await expect(page).toHaveURL(`/rubric?project=${THESIS_PROJECT_ID}`);
  await expect(page.getByRole('heading', { name: 'Sidang skripsi Indonesia', exact: true })).toBeVisible();
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Research method fit');
  await expect(page.getByLabel('Kriteria').nth(1)).toHaveValue('Defensible findings');

  await page.getByLabel('Kriteria').first().fill('Research method fit and trade-offs');
  await page.getByRole('button', { name: 'Simpan rubrik' }).click();
  await expect(page.locator('[data-toast-variant="positive"]')).toContainText(
    '2 confirmed criteria saved to Sidang skripsi Indonesia',
  );
  expect(rubricPuts).toHaveLength(1);
  expect(rubricPuts[0]).toMatchObject({
    projectId: THESIS_PROJECT_ID,
    body: {
      sourceType: 'imported',
      criteria: [
        {
          name: 'Research method fit and trade-offs',
          description: 'Connect the research question to the selected method.',
          requiredEvidence: ['research question', 'sampling rationale'],
          displayOrder: 0,
        },
        {
          name: 'Defensible findings',
          description: 'Separate observed findings from interpretation.',
          requiredEvidence: ['named finding', 'study limitation'],
          displayOrder: 1,
        },
      ],
    },
  });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(
    'talkactive.production.rubric.v2',
  ) ?? '{}').criteria?.[0]?.name)).toBe('Browser-global trap');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('a project-load error is visible and retry never exposes the browser-global rubric', async ({ page }) => {
  await seedBrowserGlobalTrap(page);
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  let thesisRequests = 0;
  await mockAccount(page, {
    projectResponder: async (route, projectId) => {
      if (projectId === THESIS_PROJECT_ID) {
        thesisRequests += 1;
        if (thesisRequests === 1) {
          // A malformed success body exercises the same fail-loud client path
          // without manufacturing a browser resource error, which the global
          // production gate correctly treats as a separate failure.
          await respond(route, { contractVersion: 2, workspace: { project: null } });
          return;
        }
        await respond(route, { contractVersion: 2, workspace: thesisWorkspace });
        return;
      }
      await respond(route, { contractVersion: 2, workspace: pitchWorkspace });
    },
  });

  await page.goto(`/rubric?project=${THESIS_PROJECT_ID}`);
  const alert = page.locator('section.surface[role="alert"]');
  await expect(alert).toContainText(/Invalid input|could not be loaded/iu);
  await expect(page.getByText('Browser-global trap')).toHaveCount(0);
  await alert.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByRole('heading', { name: 'Sidang skripsi Indonesia', exact: true })).toBeVisible();
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Research method fit');
  expect(thesisRequests).toBe(2);
  expect(consoleMessages).not.toContainEqual(expect.stringMatching(/Failed to load resource/iu));
});

test('a project with saved practice explains the lock and exposes no editable save path', async ({ page }) => {
  const lockedPitch = project(PITCH_PROJECT_ID, 'English product pitch', 'en-US', 2);
  await seedBrowserGlobalTrap(page);
  await mockAccount(page, { projects: [lockedPitch, thesisProject] });

  await page.goto(`/rubric?project=${PITCH_PROJECT_ID}`);
  await expect(page.getByText('Rubrik terkunci setelah latihan tersimpan.')).toBeVisible();
  await expect(page.getByText(/keep earlier evidence traceable/iu)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simpan rubrik' })).toBeDisabled();
  await expect(page.getByLabel('Kriteria').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: /Hackathon pitch/i })).toBeDisabled();
  await expect(page.getByText('Browser-global trap')).toHaveCount(0);
});

test('browser Back during an in-flight save cannot disable or overwrite the restored project', async ({ page }) => {
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await mockAccount(page, {
    onRubricPut: async (route, projectId) => {
      const body = route.request().postDataJSON() as {
        sourceType: 'manual' | 'imported' | 'library';
        criteria: Array<{
          name: string;
          description: string;
          requiredEvidence: string[];
          displayOrder: number;
        }>;
      };
      await saveGate;
      const rubricId = `${projectId}:late-rubric`;
      await respond(route, {
        contractVersion: 2,
        rubric: {
          id: rubricId,
          projectId,
          sourceType: body.sourceType,
          confirmedAt: CREATED,
          createdAt: CREATED,
        },
        criteria: body.criteria.map((criterion, index) => ({
          ...criterion,
          id: `${projectId}:late:${index}`,
          rubricId,
        })),
      });
    },
  });

  await page.goto(`/rubric?project=${THESIS_PROJECT_ID}`);
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Research method fit');
  await page.getByLabel('Proyek').selectOption(PITCH_PROJECT_ID);
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Verified customer impact');
  await page.getByLabel('Kriteria').first().fill('Edited pitch impact');
  await page.getByRole('button', { name: 'Simpan rubrik' }).click();
  await expect(page.getByRole('button', { name: 'Menyimpan rubrik…' })).toBeDisabled();

  await page.goBack();
  await expect(page).toHaveURL(`/rubric?project=${THESIS_PROJECT_ID}`);
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Research method fit');

  releaseSave();
  await expect(page.getByRole('button', { name: 'Simpan rubrik' })).toBeEnabled();
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Research method fit');
  await expect(page.locator('[data-toast-variant="positive"]')).toHaveCount(0);
});

test('switching projects aborts an in-flight rubric parse before it can populate the next project', async ({ page }) => {
  let releaseParse!: () => void;
  const parseGate = new Promise<void>((resolve) => { releaseParse = resolve; });
  await mockAccount(page);
  await page.route('**/api/rubrics/parse', async (route) => {
    await parseGate;
    await respond(route, {
      contractVersion: 2,
      criteria: [{
        clientId: 'late-import',
        name: 'Late criteria from the thesis project',
        description: 'This result must be discarded after the project changes.',
        requiredEvidence: ['originating project only'],
        sourceExcerpt: 'Late criteria from the thesis project',
        displayOrder: 0,
      }],
      mode: 'deterministic',
      model: null,
      requiresConfirmation: true,
    });
  });

  await page.goto(`/rubric?project=${THESIS_PROJECT_ID}`);
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Research method fit');
  await page.getByText('Impor dari matriks penilaian').click();
  await page.getByLabel('Tempel matriks penilaian').fill('Late criteria from the thesis project');
  await page.getByRole('button', { name: 'Strukturkan kriteria ini' }).click();
  await expect(page.getByRole('button', { name: 'Menstrukturkan…' })).toBeDisabled();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByLabel('Proyek').selectOption(PITCH_PROJECT_ID);
  await expect(page).toHaveURL(`/rubric?project=${PITCH_PROJECT_ID}`);
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Verified customer impact');

  releaseParse();
  await expect(page.getByLabel('Kriteria').first()).toHaveValue('Verified customer impact');
  await expect(page.getByText('Late criteria from the thesis project')).toHaveCount(0);
  await expect(page.locator('[data-toast-variant="warning"]')).toHaveCount(0);
});
