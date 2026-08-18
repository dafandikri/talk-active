import { expect, test, type Page } from '@playwright/test';

const CREATED = '2026-08-13T08:00:00.000Z';
const ENGLISH_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const INDONESIAN_PROJECT_ID = '22222222-2222-4222-8222-222222222222';

function workspace(
  id: string,
  title: string,
  language: 'id-ID' | 'en-US',
  criterionName: string,
) {
  const rubricId = `${id}:rubric`;
  return {
    project: {
      id,
      userId: 'practice-owner',
      title,
      language,
      eventContext: 'Final presentation',
      deadline: '2026-08-14',
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    rubric: {
      id: rubricId,
      projectId: id,
      sourceType: 'manual' as const,
      confirmedAt: CREATED,
      createdAt: CREATED,
    },
    criteria: [{
      id: `${id}:criterion`,
      rubricId,
      name: criterionName,
      description: 'State the exact evidence an evaluator can verify.',
      requiredEvidence: ['measured outcome'],
      displayOrder: 0,
    }],
    sourceDocuments: [],
  };
}

async function mockProjectPractice(page: Page) {
  const workspaces = new Map([
    [ENGLISH_PROJECT_ID, workspace(ENGLISH_PROJECT_ID, 'English product pitch', 'en-US', 'Verified impact')],
    [INDONESIAN_PROJECT_ID, workspace(INDONESIAN_PROJECT_ID, 'Pitch inovasi Indonesia', 'id-ID', 'Dampak terukur')],
  ]);
  const patches: Array<{ id: string; language: string }> = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (url.pathname === '/api/capabilities') {
      return respond({
        contractVersion: 2,
        persistence: 'neon',
        accounts: true,
        sourceDocuments: false,
        recordings: true,
        semantic: { rubric: false, evidence: false, question: false, defense: false, coach: false },
      });
    }
    if (url.pathname === '/api/projects' && request.method() === 'GET') {
      return respond({
        contractVersion: 2,
        identity: 'account',
        projects: [...workspaces.values()].map((item) => ({
          project: item.project,
          attemptCount: 0,
          lastAttemptAt: null,
          rubricConfirmed: true,
        })),
      });
    }
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/u);
    if (projectMatch) {
      const id = projectMatch[1];
      const item = id ? workspaces.get(id) : undefined;
      if (!item) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as { language: 'id-ID' | 'en-US' };
        patches.push({ id, language: body.language });
        item.project.language = body.language;
        return respond({ contractVersion: 2, project: item.project });
      }
      return respond({ contractVersion: 2, workspace: item });
    }
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  return patches;
}

test('selected project owns the rubric, language, direct studio, and browser history', async ({ page }) => {
  const patches = await mockProjectPractice(page);
  await page.goto(`/practice?project=${ENGLISH_PROJECT_ID}`);

  await expect(page.locator('.setup-project-summary strong')).toHaveText('English product pitch');
  await expect(page.locator('.setup-rubric')).toContainText('Verified impact');
  await expect(page.getByLabel('Choose project')).toHaveValue(ENGLISH_PROJECT_ID);
  await expect(page.getByLabel('Project language')).toHaveValue('en-US');

  await page.getByLabel('Project language').selectOption('id-ID');
  await expect(page.getByRole('status')).toContainText('Project language synced');
  expect(patches).toEqual([{ id: ENGLISH_PROJECT_ID, language: 'id-ID' }]);

  await page.getByRole('button', { name: /Begin this attempt/i }).click();

  // Writing is the default route to a transcript, so the step opens with no
  // capture panel at all and nothing asked of the camera or microphone.
  await expect(page.locator('.capture-header h2')).toHaveText('English product pitch');
  await expect(page.getByLabel('Practice transcript')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write or paste' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Rehearse the whole performance.' })).toHaveCount(0);

  // Choosing live capture reveals the observation checklist, and every signal
  // in it starts off. The project language decides the dictation language.
  await page.getByRole('button', { name: 'Record live' }).click();
  await expect(page.getByRole('heading', { name: 'Rehearse the whole performance.' })).toBeVisible();
  await expect(page.getByRole('group', { name: /Pilih apa yang boleh diamati latihan ini/i })).toBeVisible();
  await expect(page.getByText('Project language: Bahasa Indonesia', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Kamera landmark lokal/i })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Suara isyarat lokal/i })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Transkrip langsung Bahasa Indonesia/i })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Simpan rekaman kamera \+ mikrofon/i })).not.toBeChecked();
  await page.getByRole('button', { name: 'Write or paste' }).click();

  const preservedDraft = 'This draft must survive browser Back and Forward inside Practice.';
  await page.getByLabel('Practice transcript').fill(preservedDraft);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'What are you preparing for?' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goForward();
  await expect(page.locator('.capture-header h2')).toBeFocused();
  await expect(page.getByLabel('Practice transcript')).toHaveValue(preservedDraft);

  await page.getByRole('link', { name: 'Back to workspace' }).click();
  await expect(page).toHaveURL(`/workspace?project=${ENGLISH_PROJECT_ID}`);
  await page.goBack();
  await expect(page).toHaveURL(`/practice?project=${ENGLISH_PROJECT_ID}`);
  await expect(page.locator('.capture-header h2')).toHaveText('English product pitch');
  await expect(page.getByLabel('Practice transcript')).toHaveValue(preservedDraft);

  await page.getByRole('button', { name: 'Back to project setup' }).click();
  await expect(page.getByRole('heading', { name: 'What are you preparing for?' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('link', { name: 'Edit' }))
    .toHaveAttribute('href', `/rubric?project=${ENGLISH_PROJECT_ID}`);
  await page.getByLabel('Choose project').selectOption(INDONESIAN_PROJECT_ID);
  await expect(page).toHaveURL(`/practice?project=${INDONESIAN_PROJECT_ID}`);
  await expect(page.locator('.setup-project-summary strong')).toHaveText('Pitch inovasi Indonesia');
  await expect(page.locator('.setup-rubric')).toContainText('Dampak terukur');

  await page.goBack();
  await expect(page).toHaveURL(`/practice?project=${ENGLISH_PROJECT_ID}`);
  await expect(page.locator('.setup-project-summary strong')).toHaveText('English product pitch');
});
