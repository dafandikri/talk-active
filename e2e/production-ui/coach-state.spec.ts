import { expect, test } from '@playwright/test';

// The dashboard's only illustration is supposed to report the state of the
// work. That claim is worth checking in a real browser: a pose chosen in a
// component is easy to get right and just as easy to leave hardcoded.

const SESSIONS_KEY = 'talkactive.production.sessions.v1';

function savedSession(evidenceScore: number, weakest: string) {
  return [{
    id: '019ff7f4-e54b-7aaa-baba-1234567890ab',
    createdAt: '2026-08-13T02:00:00.000Z',
    evidenceScore,
    weakest,
    defenseStatus: 'developing',
    projectId: null,
    criteria: [],
  }];
}

test('with nothing saved, the coach is waiting and the art has loaded', async ({ page }) => {
  await page.goto('/workspace');
  const mascot = page.locator('.focus-mascot');
  await expect(mascot).toHaveAttribute('data-coach', 'waiting');
  await expect(mascot).toHaveJSProperty('complete', true);
  await expect(page.locator('.coach-bubble')).toContainText('Ready for the hard question?');
});

test('an open gap names the criterion it is open on', async ({ page }) => {
  await page.addInitScript(([key, rows]) => localStorage.setItem(key as string, JSON.stringify(rows)),
    [SESSIONS_KEY, savedSession(62, 'Differentiation')] as const);
  await page.goto('/workspace');

  const mascot = page.locator('.focus-mascot');
  await expect(mascot).toHaveAttribute('data-coach', 'gap');
  await expect(mascot).toHaveJSProperty('complete', true);
  // Naming the criterion is the point. "You have a gap" would be a mood.
  await expect(page.locator('.coach-bubble')).toContainText('Differentiation');
});

test('complete coverage switches the pose rather than repeating the gap', async ({ page }) => {
  await page.addInitScript(([key, rows]) => localStorage.setItem(key as string, JSON.stringify(rows)),
    [SESSIONS_KEY, savedSession(100, 'Differentiation')] as const);
  await page.goto('/workspace');

  const mascot = page.locator('.focus-mascot');
  await expect(mascot).toHaveAttribute('data-coach', 'supported');
  await expect(mascot).toHaveJSProperty('complete', true);
  await expect(page.locator('.coach-bubble')).not.toContainText('gap is still open');
});

test('each state draws a different pose, so the state is visible not just labelled', async ({ page }) => {
  const sourceFor = async (rows: unknown | null) => {
    if (rows) {
      await page.addInitScript(([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)),
        [SESSIONS_KEY, rows] as const);
    }
    await page.goto('/workspace');
    return page.locator('.focus-mascot').getAttribute('src');
  };

  const waiting = await sourceFor(null);
  await page.context().clearCookies();
  const gap = await sourceFor(savedSession(62, 'Differentiation'));

  expect(waiting).not.toEqual(gap);
  expect(waiting).toBeTruthy();
});
