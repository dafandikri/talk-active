import { expect, test } from '@playwright/test';

test('multimodal studio captures local camera cues and assembles the three-layer review', async ({ page }) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];
  const localAssets = new Set<string>();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4183') localAssets.add(url.pathname);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== 'http://127.0.0.1:4183') {
      externalRequests.push(request.url());
    }
  });

  await page.goto('/practice');
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await expect(page.getByRole('heading', { name: 'Rehearse the whole performance.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Presentation/i })).toHaveAttribute('class', /is-active/u);

  await page.getByRole('button', { name: /Interview/i }).click();
  await page.getByRole('button', { name: /Start camera rehearsal/i }).click();
  await expect(page.getByRole('button', { name: /Finish & assemble review/i })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_600);
  await page.getByRole('button', { name: /Finish & assemble review/i }).click();
  await expect(page.getByRole('button', { name: /Start camera rehearsal/i })).toBeVisible();

  await page.getByRole('button', { name: /Presentation/i }).click();
  await page.getByRole('button', { name: /Start camera rehearsal/i }).click();
  await expect(page.getByRole('button', { name: /Finish & assemble review/i })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Practice transcript').fill(
    'Um our problem affects students. Our rubric feedback makes every claim traceable. '
    + 'The prototype architecture keeps privacy explicit and the implementation feasible.',
  );
  await page.waitForTimeout(3_800);
  await page.screenshot({ path: '.codex-qa/multimodal-attempt.png', fullPage: true });
  await page.getByRole('button', { name: /Finish & assemble review/i }).click();
  await expect(page.locator('.studio-status')).toContainText('Rehearsal captured');
  await page.getByLabel('Practice transcript').fill(
    'Um, our problem affects students and our evidence shows urgency. '
    + 'Our solution uses rubric feedback so every retry improves. '
    + 'Unlike competitors, our unique traceable logic maps every claim. '
    + 'We we built a feasible prototype architecture with explicit privacy limitations.',
  );
  await page.getByRole('button', { name: /Review this attempt/i }).click();

  await expect(page.getByRole('heading', { name: 'How the attempt came across' })).toBeVisible();
  await expect(page.getByText('Overall rehearsal', { exact: true })).toBeVisible();
  await expect(page.getByText('Substance', { exact: true })).toBeVisible();
  await expect(page.getByText('Vocal delivery', { exact: true })).toBeVisible();
  await expect(page.getByText('Visual delivery', { exact: true })).toBeVisible();
  await expect(page.getByText('Voice evidence', { exact: true })).toBeVisible();
  await expect(page.getByText('Camera evidence', { exact: true })).toBeVisible();
  await expect(page.getByText('Transcript cue evidence', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.codex-qa/multimodal-review.png', fullPage: true });

  expect([...localAssets]).toEqual(expect.arrayContaining([
    '/mediapipe/models/face_landmarker.task',
    '/mediapipe/models/pose_landmarker_lite.task',
  ]));

  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.performance-score-grid')).toBeVisible();
  const mobileReview = page.locator('.multimodal-review');
  const mobileBox = await mobileReview.boundingBox();
  expect(mobileBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((mobileBox?.x ?? 0) + (mobileBox?.width ?? 999)).toBeLessThanOrEqual(390);
  await mobileReview.screenshot({ path: '.codex-qa/multimodal-review-mobile.png' });
});
