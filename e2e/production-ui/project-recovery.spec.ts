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
      recordings: false,
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
  await page.getByRole('button', { name: /Mulai percobaan ini/i }).click();
  await expect(page.getByText(/sudah punya rubrik terkonfirmasi/u)).toBeVisible();
  await expect(page.getByText('recovered-proposal.md', { exact: true })).toBeVisible();
  expect(currentCalls).toBe(1);
  expect(createCalls).toBe(0);

  await page.reload();
  await expect(page.getByText('Recovered impact', { exact: true })).toBeVisible();
  expect(currentCalls).toBe(2);
  expect(createCalls).toBe(0);
});

// Restoring a saved project is optional. The capability probe is not. Sharing
// one catch between them meant a single failed recovery revoked capabilities
// the server had already confirmed: source attachments disappeared, the session
// fell back to local, and nothing on screen said why.
test('a failed project recovery keeps the capabilities the server confirmed', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/capabilities') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contractVersion,
          persistence: 'neon',
          accounts: true,
          sourceDocuments: true,
          recordings: false,
          semantic: { rubric: false, evidence: false, question: false, defense: false },
        }),
      });
    }
    if (pathname === '/api/projects/current') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/practice');
  await page.getByRole('button', { name: /Mulai percobaan ini/i }).click();

  // The capability survives the failed recovery.
  await expect(page.getByText('Dasarkan pertanyaan juri pada materi Anda')).toBeVisible();
  // And the failure is stated rather than absorbed (INV-4).
  await expect(page.getByText(/proyek tersimpan Anda belum bisa dipulihkan/iu)).toBeVisible();
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
          recordings: false,
          semantic: { rubric: false, evidence: false, question: false, defense: false },
        }),
      });
    }
    if (pathname === '/api/projects/current') currentCalls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/practice');
  await page.getByRole('button', { name: /Mulai percobaan ini/i }).click();
  await expect(page.getByText('Riwayat sesi tetap di browser ini')).toBeVisible();
  expect(currentCalls).toBe(0);
});
