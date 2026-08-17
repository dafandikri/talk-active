import { expect, test, type Page } from '@playwright/test';

// The workspace could always hold more than one project — the table is
// owner-scoped — but the interface named exactly one, in markup, in four
// places. These tests pin the two properties that matter once there is a
// second: the switcher only exists when it can actually switch, and every
// surface that names a project names the one being shown.

const CREATED = '2026-08-10T08:00:00.000Z';

function project(id: string, title: string, attemptCount: number, language: 'id-ID' | 'en-US' = 'id-ID') {
  return {
    project: {
      id,
      userId: 'user-switcher',
      title,
      language,
      eventContext: null,
      deadline: null,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    attemptCount,
    lastAttemptAt: attemptCount === 0 ? null : CREATED,
    rubricConfirmed: true,
  };
}

function progressFor(projectId: string, coverage: number) {
  return {
    contractVersion: 2,
    projectId,
    attempts: [{
      attemptId: `${projectId}-attempt`,
      createdAt: CREATED,
      coverage,
      hasDeliveryReview: false,
      recordingStatus: null,
    }],
    recurringWeaknesses: [],
    attemptComparisons: [],
  };
}

async function mockWorkspace(page: Page, projects: ReturnType<typeof project>[]) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const respond = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (url.pathname === '/api/capabilities') return respond({
      contractVersion: 2,
      persistence: 'neon',
      accounts: true,
      sourceDocuments: false,
      recordings: false,
      semantic: { rubric: false, evidence: false, question: false, defense: false },
    });
    if (url.pathname === '/api/projects') return respond({
      contractVersion: 2,
      identity: 'account',
      projects,
    });
    const progressMatch = url.pathname.match(/^\/api\/progress\/(.+)$/u);
    if (progressMatch) {
      return respond(progressFor(progressMatch[1], progressMatch[1] === 'p-finals' ? 0.8 : 0.4));
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('with one project there is no switcher to operate', async ({ page }) => {
  // A dropdown holding a single option is a promise the product cannot keep,
  // and the first thing anyone does with a dropdown is open it.
  await mockWorkspace(page, [project('p-finals', 'Talk-Active · RISTEK Finals', 3)]);
  await page.goto('/progress');

  await expect(page.locator('.coverage-trend')).toBeVisible();
  await expect(page.locator('.project-switcher')).toHaveCount(0);
  await expect(page.locator('.full-session-list')).toContainText('Talk-Active · RISTEK Finals');
});

test('a second project brings a switcher, and switching changes the history shown', async ({ page }) => {
  await mockWorkspace(page, [
    project('p-finals', 'Talk-Active · RISTEK Finals', 3),
    project('p-thesis', 'Thesis defence · Semester 7', 1, 'en-US'),
  ]);
  await page.goto('/progress');

  const switcher = page.locator('.project-switcher');
  await expect(switcher).toBeVisible();
  await expect(switcher.locator('option')).toHaveCount(2);

  // The archive is stamped with the project being shown, not with a title
  // compiled into the page.
  await expect(page.locator('.full-session-list')).toContainText('Talk-Active · RISTEK Finals');
  await expect(page.locator('.coverage-trend-latest')).toContainText('80%');

  await switcher.locator('select').selectOption('p-thesis');

  await expect(page).toHaveURL('/progress?project=p-thesis');
  await expect(page.locator('.main-nav a').filter({ hasText: 'Beranda' }))
    .toHaveAttribute('href', '/workspace?project=p-thesis');
  await expect(page.locator('.mobile-nav a').filter({ hasText: 'Rubrik' }))
    .toHaveAttribute('href', '/rubric?project=p-thesis');
  await expect(page.locator('.full-session-list')).toContainText('Thesis defence · Semester 7');
  await expect(page.locator('.full-session-list')).not.toContainText('RISTEK Finals');
  // Switching has to refetch, not just relabel. A page that renames the header
  // while showing the previous project's numbers is worse than no switcher.
  await expect(page.locator('.coverage-trend-latest')).toContainText('40%');

  await page.goBack();
  await expect(page).toHaveURL('/progress?project=p-finals');
  await expect(switcher.locator('select')).toHaveValue('p-finals');
  await expect(page.locator('.coverage-trend-latest')).toContainText('80%');
});

test('a project-specific progress deep link survives reload', async ({ page }) => {
  await mockWorkspace(page, [
    project('p-finals', 'Talk-Active · RISTEK Finals', 3),
    project('p-thesis', 'Thesis defence · Semester 7', 1, 'en-US'),
  ]);
  await page.goto('/progress?project=p-thesis');

  await expect(page.locator('.project-switcher select')).toHaveValue('p-thesis');
  await expect(page.locator('.full-session-list')).toContainText('Thesis defence · Semester 7');
  await expect(page.locator('.coverage-trend-latest')).toContainText('40%');

  await page.reload();
  await expect(page).toHaveURL('/progress?project=p-thesis');
  await expect(page.locator('.project-switcher select')).toHaveValue('p-thesis');
  await expect(page.locator('.coverage-trend-latest')).toContainText('40%');
});

test('the workspace project choice carries its identity into practice and survives reload', async ({ page }) => {
  await mockWorkspace(page, [
    project('p-finals', 'Talk-Active · RISTEK Finals', 3),
    project('p-thesis', 'Thesis defence · Semester 7', 1, 'en-US'),
  ]);
  await page.goto('/workspace');

  const switcher = page.locator('.project-switcher');
  await expect(switcher).toBeVisible();
  await switcher.locator('select').selectOption('p-thesis');
  await expect(page.locator('.project-kicker')).toContainText('Thesis defence · Semester 7');
  await expect(page.getByRole('link', { name: 'Continue practising' }))
    .toHaveAttribute('href', '/practice?project=p-thesis');
  await expect(page).toHaveURL(/\/workspace\?project=p-thesis$/u);

  await page.reload();
  await expect(switcher.locator('select')).toHaveValue('p-thesis');
  await expect(page.locator('.project-kicker')).toContainText('Thesis defence · Semester 7');
});

test('the switcher reports what each project actually holds', async ({ page }) => {
  await mockWorkspace(page, [
    project('p-finals', 'Talk-Active · RISTEK Finals', 3),
    project('p-empty', 'Grant pitch · not started', 0),
  ]);
  await page.addInitScript(() => localStorage.setItem('talkactive.production.sessions.v1', JSON.stringify([{
    id: 'browser-interview-summary',
    createdAt: '2026-08-11T08:00:00.000Z',
    evidenceScore: 80,
    weakest: 'Impact evidence',
    defenseStatus: null,
    projectId: 'p-finals',
    projectTitle: 'Talk-Active · RISTEK Finals',
    projectLanguage: 'id-ID',
    criteria: [],
  }])));
  await page.goto('/progress');

  const switcher = page.locator('.project-switcher');
  await expect(switcher.locator('.project-switcher-meta'))
    .toHaveText('3 synced attempts · 1 browser-only summary');

  await switcher.locator('select').selectOption('p-empty');
  await expect(switcher.locator('.project-switcher-meta')).toContainText('No attempts saved to this project yet');
});

test('the sidebar lists every owned project instead of one written-in name', async ({ page }) => {
  await mockWorkspace(page, [
    project('p-finals', 'Talk-Active · RISTEK Finals', 3),
    project('p-thesis', 'Thesis defence · Semester 7', 1, 'en-US'),
  ]);
  await page.goto('/progress');

  const sidebar = page.locator('.sidebar-project-list');
  await expect(sidebar.locator('.sidebar-project')).toHaveCount(2);
  await expect(sidebar).toContainText('Thesis defence · Semester 7');
  await expect(sidebar.getByRole('link', { name: /Talk-Active · RISTEK Finals/i }))
    .toHaveAttribute('aria-current', 'true');
});

test('a signed-out visitor asks for no project list and keeps its local workspace', async ({ page }) => {
  let projectRequests = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/projects') projectRequests += 1;
    if (url.pathname === '/api/capabilities') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contractVersion: 2,
          persistence: 'local',
          accounts: false,
          sourceDocuments: false,
          recordings: false,
          semantic: { rubric: false, evidence: false, question: false, defense: false },
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/progress');
  await expect(page.locator('.sidebar-project-list')).toContainText('Ruang kerja lokal');

  // The list route requires a synced identity, so asking as a guest would 401 —
  // and a 401 is a console error, which the demo gate treats as a broken path.
  // The capability probe already says whether there is an owner to ask about.
  expect(projectRequests, 'a guest must not request a list it cannot be shown').toBe(0);
  await expect(page.locator('.project-switcher')).toHaveCount(0);
});
