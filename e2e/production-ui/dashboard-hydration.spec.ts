import { expect, test } from '@playwright/test';

test('dashboard hydrates saved rubric and session progress without placeholder metrics', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('talkactive.production.rubric.v2', JSON.stringify({
      version: 2,
      criteria: [
        {
          id: 'problem-framing',
          name: 'Problem framing',
          description: 'Show who experiences the problem and why it matters.',
          requiredEvidence: ['affected students', 'frequency'],
          sourceExcerpt: null,
          displayOrder: 0,
        },
        {
          id: 'execution-proof',
          name: 'Execution proof',
          description: 'Show that the live product path works.',
          requiredEvidence: ['working demo', 'fallback'],
          sourceExcerpt: null,
          displayOrder: 1,
        },
        {
          id: 'adoption-plan',
          name: 'Adoption plan',
          description: 'Name the next validation step.',
          requiredEvidence: ['pilot', 'feedback'],
          sourceExcerpt: null,
          displayOrder: 2,
        },
      ],
    }));
    localStorage.setItem('talkactive.production.sessions.v1', JSON.stringify([
      {
        id: 'saved-older',
        createdAt: '2026-08-11T08:00:00.000Z',
        evidenceScore: 50,
        weakest: 'Problem framing',
        defenseStatus: null,
        projectId: null,
        criteria: [],
      },
      {
        id: 'saved-latest',
        createdAt: '2026-08-12T08:00:00.000Z',
        evidenceScore: 75,
        weakest: 'Execution proof',
        defenseStatus: 'developing',
        projectId: null,
        criteria: [],
      },
    ]));
  });

  await page.goto('/workspace');

  await expect(page.getByRole('heading', {
    name: 'Lanjutkan dari fokus tersimpan terakhir: Execution proof.',
  })).toBeVisible();
  await expect(page.locator('.focus-stat').filter({ hasText: 'Cakupan bukti terakhir' })).toContainText('75%');
  await expect(page.locator('.focus-stat').filter({ hasText: 'Cakupan bukti terakhir' })).toContainText('Agu');
  await expect(page.locator('.focus-stat').filter({ hasText: 'Fokus terbaru' })).toContainText('Execution proof');
  await expect(page.locator('.focus-stat').filter({ hasText: 'Sesi tersimpan' })).toContainText('2');

  await expect(page.getByRole('heading', { name: 'Rubrik aktif' })).toBeVisible();
  await expect(page.locator('.health-ring')).toHaveText('3');
  await expect(page.locator('.mini-criterion')).toHaveText([
    'Problem framing',
    'Execution proof',
    'Adoption plan',
  ]);

  const recentSessions = page.locator('.recent-section .session-row');
  await expect(recentSessions).toHaveCount(2);
  await expect(recentSessions.nth(0)).toContainText('Fokus tersimpan: Execution proof');
  await expect(recentSessions.nth(0).locator('.session-date')).toContainText('Agu');
  await expect(recentSessions.nth(0)).toContainText('75%');
  await expect(recentSessions.nth(1)).toContainText('Fokus tersimpan: Problem framing');
  await expect(page.getByText('5 min', { exact: true })).toHaveCount(0);
});
