import { expect, test, type Page, type Route } from '@playwright/test';

const CREATED = '2026-08-13T08:00:00.000Z';
const PITCH_PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const THESIS_PROJECT_ID = '44444444-4444-4444-8444-444444444444';

function project(
  id: string,
  title: string,
  language: 'id-ID' | 'en-US',
  rubricConfirmed: boolean,
) {
  return {
    id,
    userId: 'workspace-owner',
    title,
    language,
    eventContext: 'Live evaluation',
    deadline: '2026-08-14',
    createdAt: CREATED,
    updatedAt: CREATED,
    rubricConfirmed,
  };
}

const pitchProject = project(PITCH_PROJECT_ID, 'English product pitch', 'en-US', true);
const thesisProject = project(THESIS_PROJECT_ID, 'Sidang skripsi Indonesia', 'id-ID', false);

function criterion(projectId: string, rubricId: string, id: string, name: string, displayOrder: number) {
  return {
    id: `${projectId}:${id}`,
    rubricId,
    name,
    description: 'Name evidence the evaluator can verify.',
    requiredEvidence: ['named result'],
    displayOrder,
  };
}

function confirmedPitchWorkspace() {
  const rubricId = `${PITCH_PROJECT_ID}:rubric`;
  return {
    project: { ...pitchProject, rubricConfirmed: undefined },
    rubric: {
      id: rubricId,
      projectId: PITCH_PROJECT_ID,
      sourceType: 'manual' as const,
      confirmedAt: CREATED,
      createdAt: CREATED,
    },
    criteria: [
      criterion(PITCH_PROJECT_ID, rubricId, 'impact', 'Verified customer impact', 0),
      criterion(PITCH_PROJECT_ID, rubricId, 'delivery', 'Working demo path', 1),
    ],
    sourceDocuments: [],
  };
}

function draftThesisWorkspace() {
  const rubricId = `${THESIS_PROJECT_ID}:rubric`;
  return {
    project: { ...thesisProject, rubricConfirmed: undefined },
    rubric: {
      id: rubricId,
      projectId: THESIS_PROJECT_ID,
      sourceType: 'imported' as const,
      confirmedAt: null,
      createdAt: CREATED,
    },
    criteria: [
      criterion(THESIS_PROJECT_ID, rubricId, 'method', 'Draft research method', 0),
    ],
    sourceDocuments: [],
  };
}

const projectWorkspaces = new Map([
  [PITCH_PROJECT_ID, confirmedPitchWorkspace()],
  [THESIS_PROJECT_ID, draftThesisWorkspace()],
]);

function respond(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function seedBrowserGlobalRubric(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('talkactive.production.rubric.v2', JSON.stringify({
      version: 2,
      criteria: [{
        id: 'browser-global-trap',
        name: 'Browser-global trap',
        description: 'This must never appear for a synced project.',
        requiredEvidence: ['wrong project'],
        sourceExcerpt: null,
        displayOrder: 0,
      }],
    }));
  });
}

async function mockOwnedProjects(
  page: Page,
  projectResponder?: (route: Route, projectId: string) => Promise<void>,
) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
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
      return respond(route, {
        contractVersion: 2,
        identity: 'account',
        projects: [pitchProject, thesisProject].map((item) => ({
          project: {
            id: item.id,
            userId: item.userId,
            title: item.title,
            language: item.language,
            eventContext: item.eventContext,
            deadline: item.deadline,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          },
          attemptCount: item.id === PITCH_PROJECT_ID ? 2 : 0,
          lastAttemptAt: item.id === PITCH_PROJECT_ID ? CREATED : null,
          rubricConfirmed: item.rubricConfirmed,
        })),
      });
    }
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/u);
    if (projectMatch?.[1]) {
      if (projectResponder) return projectResponder(route, projectMatch[1]);
      const workspace = projectWorkspaces.get(projectMatch[1]);
      if (workspace) return respond(route, { contractVersion: 2, workspace });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test('deep-linking and switching keep project title, language, practice URL, and confirmed rubric together', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrowserGlobalRubric(page);
  let releaseThesis!: () => void;
  const thesisGate = new Promise<void>((resolve) => { releaseThesis = resolve; });
  await mockOwnedProjects(page, async (route, projectId) => {
    if (projectId === THESIS_PROJECT_ID) await thesisGate;
    const workspace = projectWorkspaces.get(projectId);
    if (!workspace) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    await respond(route, { contractVersion: 2, workspace });
  });

  await page.goto(`/workspace?project=${THESIS_PROJECT_ID}`);
  const rubric = page.locator('.rubric-health');
  await expect(page.locator('.project-kicker')).toContainText('Sidang skripsi Indonesia');
  await expect(page.locator('.project-kicker')).toContainText('Bahasa Indonesia');
  await expect(rubric.getByRole('status')).toContainText('Loading Sidang skripsi Indonesia');
  await expect(rubric).not.toContainText('Browser-global trap');

  releaseThesis();
  await expect(rubric).toContainText('No confirmed rubric belongs to Sidang skripsi Indonesia yet.');
  await expect(rubric.locator('.health-ring')).toHaveText('0');
  await expect(rubric).not.toContainText('Draft research method');
  await expect(page.getByRole('link', { name: 'Continue practising' }))
    .toHaveAttribute('href', `/practice?project=${THESIS_PROJECT_ID}`);
  await expect(page.getByRole('link', { name: 'Review rubric' }))
    .toHaveAttribute('href', `/rubric?project=${THESIS_PROJECT_ID}`);
  await expect(page.getByRole('link', { name: 'View all' }))
    .toHaveAttribute('href', `/progress?project=${THESIS_PROJECT_ID}`);

  await page.getByLabel('Project').selectOption(PITCH_PROJECT_ID);
  await expect(page).toHaveURL(`/workspace?project=${PITCH_PROJECT_ID}`);
  await expect(page.locator('.project-kicker')).toContainText('English product pitch');
  await expect(page.locator('.project-kicker')).toContainText('English');
  await expect(rubric).toContainText('2 confirmed criteria belong to English product pitch.');
  await expect(rubric.locator('.mini-criterion')).toHaveText([
    'Verified customer impact',
    'Working demo path',
  ]);
  await expect(rubric).not.toContainText('Browser-global trap');
  await expect(page.getByRole('link', { name: 'Continue practising' }))
    .toHaveAttribute('href', `/practice?project=${PITCH_PROJECT_ID}`);
  await expect(page.getByRole('link', { name: 'View all' }))
    .toHaveAttribute('href', `/progress?project=${PITCH_PROJECT_ID}`);

  await page.goBack();
  await expect(page).toHaveURL(`/workspace?project=${THESIS_PROJECT_ID}`);
  await expect(page.locator('.project-kicker')).toContainText('Sidang skripsi Indonesia');
  await expect(rubric).toContainText('No confirmed rubric belongs to Sidang skripsi Indonesia yet.');
  await expect(rubric).not.toContainText('Verified customer impact');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('a mismatched project response is rejected visibly and retry recovers without leaking the other rubric', async ({ page }) => {
  await seedBrowserGlobalRubric(page);
  let detailRequests = 0;
  await mockOwnedProjects(page, async (route, projectId) => {
    detailRequests += 1;
    const workspace = detailRequests === 1
      ? draftThesisWorkspace()
      : projectWorkspaces.get(projectId);
    await respond(route, { contractVersion: 2, workspace });
  });

  await page.goto(`/workspace?project=${PITCH_PROJECT_ID}`);
  const rubric = page.locator('.rubric-health');
  await expect(rubric.getByRole('alert')).toContainText('The server returned a different project. Nothing from it was shown.');
  await expect(rubric).not.toContainText('Draft research method');
  await expect(rubric).not.toContainText('Browser-global trap');

  await rubric.getByRole('button', { name: 'Try again' }).click();
  await expect(rubric.locator('.mini-criterion')).toHaveText([
    'Verified customer impact',
    'Working demo path',
  ]);
  expect(detailRequests).toBe(2);
});

test('an unavailable deep link falls back to an owned project and repairs the URL', async ({ page }) => {
  await seedBrowserGlobalRubric(page);
  await mockOwnedProjects(page);

  await page.goto('/workspace?project=project-that-is-not-owned');
  await expect(page).toHaveURL(`/workspace?project=${PITCH_PROJECT_ID}`);
  await expect(page.getByRole('status')).toContainText('That project is not available. English product pitch is shown instead.');
  await expect(page.locator('.project-kicker')).toContainText('English product pitch');
  await expect(page.locator('.rubric-health .mini-criterion')).toHaveText([
    'Verified customer impact',
    'Working demo path',
  ]);
});
