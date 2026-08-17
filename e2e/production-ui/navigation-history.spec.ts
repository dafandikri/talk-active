import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== 'http://127.0.0.1:4183') {
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

test('landing, entry, and workspace keep a predictable browser-back path', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByText(/How it works/i)).toHaveCount(0);
  await page.getByRole('link', { name: /Mulai berlatih/i }).first().click();
  await expect(page).toHaveURL(/\/enter$/u);
  await expect(page.getByRole('link', { name: 'Kembali ke halaman depan' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole('link', { name: /Mulai berlatih/i }).first()).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/enter$/u);
  await page.getByRole('button', { name: 'Lanjut tanpa nama' }).click();
  await expect(page).toHaveURL(/\/workspace$/u);
  const landingLink = page.getByRole('link', { name: 'Kembali ke halaman depan Talk-Active' }).last();
  await expect(landingLink).toBeVisible();
  await landingLink.click();
  await expect(page).toHaveURL(/\/$/u);
  await page.goBack();
  await expect(page).toHaveURL(/\/workspace$/u);

  await page.goBack();
  await expect(page).toHaveURL(/\/enter$/u);
  await expect(page.getByRole('heading', { name: 'Beri nama ruang kerja ini.' })).toBeVisible();

  await page.getByRole('link', { name: 'Kembali ke halaman depan' }).click();
  await expect(page).toHaveURL(/\/$/u);
});

test('short landscape uses reachable mobile chrome without overflow or color-only location', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/workspace');

  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.mobile-header')).toBeVisible();
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await expect(page.locator('.mobile-nav a[href="/workspace"]')).toHaveAttribute('aria-current', 'page');

  const shell = await page.evaluate(() => {
    const brand = document.querySelector<HTMLElement>('.mobile-header .brand');
    const active = document.querySelector<HTMLElement>('.mobile-nav a[aria-current="page"]');
    const nav = document.querySelector<HTMLElement>('.mobile-nav');
    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      brandHeight: brand?.getBoundingClientRect().height ?? 0,
      navBottom: nav?.getBoundingClientRect().bottom ?? 0,
      viewportHeight: window.innerHeight,
      activeBackground: active ? getComputedStyle(active).backgroundColor : 'transparent',
      activeInset: active ? getComputedStyle(active).boxShadow : 'none',
    };
  });
  expect(shell.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(shell.brandHeight).toBeGreaterThanOrEqual(44);
  expect(shell.navBottom).toBeLessThanOrEqual(shell.viewportHeight);
  expect(shell.activeBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(shell.activeInset).not.toBe('none');
});

test('reduced-motion preference keeps stage transitions usable and effectively instant', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/practice');
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await expect(page.locator('.capture-header h2')).toBeFocused();
  const durations = await page.locator('.view.is-visible').evaluate((view) => ({
    animation: getComputedStyle(view).animationDuration,
    transition: getComputedStyle(view).transitionDuration,
  }));
  expect(Number.parseFloat(durations.animation)).toBeLessThanOrEqual(0.001);
  expect(Number.parseFloat(durations.transition)).toBeLessThanOrEqual(0.001);
});
