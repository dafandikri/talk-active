import { expect, test } from '@playwright/test';

const contractVersion = 2;
const createdAt = '2026-08-12T08:00:00.000Z';
const projectId = 'project-recovered';
const rubricId = 'rubric-recovered';
const criteria = [
  {
    id: 'criterion-impact', rubricId, name: 'Recovered impact',
    description: 'Show a measured beneficiary outcome.',
    requiredEvidence: ['measured outcome'], displayOrder: 0,
  },
  {
    id: 'criterion-execution', rubricId, name: 'Recovered execution',
    description: 'Show that the live loop works.',
    requiredEvidence: ['working loop'], displayOrder: 1,
  },
];
const sourceDocument = {
  id: 'source-recovered', projectId, blobUrl: 'https://private.example/source-recovered',
  filename: 'recovered-proposal.md', contentType: 'text/markdown', sizeBytes: 128,
  uploadedAt: createdAt,
};

test('signed-in remount restores the owned project, rubric, and source list without creating one', async ({ page }) => {
  let currentCalls = 0;
  let createCalls = 0;
  await page.addInitScript(() => localStorage.setItem(
    'talkactive.production.rubric.v2',
    JSON.stringify({
      version: 2,
      criteria: [{
        id: 'browser-only', name: 'Browser-only edit', description: '',
        requiredEvidence: ['local cue'], sourceExcerpt: null, displayOrder: 0,
      }],
    }),
  ));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const respond = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (pathname === '/api/capabilities') return respond({
      contractVersion,
      persistence: 'neon',
      accounts: true,
      sourceDocuments: true,
      semantic: { rubric: false, evidence: false, question: false, defense: false },
    });
    if (pathname === '/api/projects/current' && request.method() === 'GET') {
      currentCalls += 1;
      return respond({
        contractVersion,
        identity: 'account',
        current: {
          project: {
            id: projectId, userId: 'user-1', title: 'Talk-Active · RISTEK Finals',
            eventContext: '7-minute pitch · 3-minute Q&A', deadline: '2026-08-14',
            createdAt, updatedAt: createdAt,
          },
          rubric: {
            id: rubricId, projectId, sourceType: 'imported', confirmedAt: createdAt, createdAt,
          },
          criteria,
          sourceDocuments: [sourceDocument],
        },
      });
    }
    if (pathname === '/api/projects' && request.method() === 'POST') {
      createCalls += 1;
    }
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/practice');
  await expect(page.getByText('Recovered impact', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await expect(page.getByText(/already has a confirmed rubric/u)).toBeVisible();
  await expect(page.getByText('recovered-proposal.md', { exact: true })).toBeVisible();
  expect(currentCalls).toBe(1);
  expect(createCalls).toBe(0);

  await page.reload();
  await expect(page.getByText('Recovered impact', { exact: true })).toBeVisible();
  expect(currentCalls).toBe(2);
  expect(createCalls).toBe(0);
});

test('guest capability never probes SQL project recovery', async ({ page }) => {
  let currentCalls = 0;
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/capabilities') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contractVersion,
          persistence: 'local',
          accounts: true,
          sourceDocuments: false,
          semantic: { rubric: false, evidence: false, question: false, defense: false },
        }),
      });
    }
    if (pathname === '/api/projects/current') currentCalls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/practice');
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await expect(page.getByText('Session history stays in this browser')).toBeVisible();
  expect(currentCalls).toBe(0);
});
