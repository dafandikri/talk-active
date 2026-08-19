import { expect, test } from '@playwright/test';

// Two language controls exist in this product and they are deliberately not the
// same control. The project language decides what Kato asks and judges in and
// is saved per project; the interface language decides what the chrome reads
// and is a property of the person. These check that the interface one works,
// persists, and never silently claims to be the other.

const LOCALE_COOKIE = 'talkactive.locale';

test('the interface defaults to Indonesian, because the audience is Indonesian', async ({ page }) => {
  await page.goto('/account');
  // The document tag matters beyond cosmetics: it is what a screen reader uses
  // to pick a voice. This was hardcoded to "en" for the whole product.
  await expect(page.locator('html')).toHaveAttribute('lang', 'id-ID');
  await expect(page.locator('#interfaceLanguage')).toHaveValue('id');
  await expect(page.getByText('Mengubah bahasa aplikasi')).toBeVisible();
});

test('switching to English re-renders the chrome and corrects the document language', async ({ page }) => {
  await page.goto('/account');
  await page.locator('#interfaceLanguage').selectOption('en');

  await expect(page.getByText('Changes the language of the app')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  // The hint has to say the two controls are different, or the second one a
  // user finds looks like a duplicate of the first (INV-4).
  await expect(page.getByText(/project language.*is set separately/i)).toBeVisible();
});

test('the choice survives a reload, so it is a setting rather than a gesture', async ({ page }) => {
  await page.goto('/account');
  await page.locator('#interfaceLanguage').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');

  await page.reload();
  await expect(page.locator('#interfaceLanguage')).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
});

test('an unrecognised cookie falls back to Indonesian rather than failing', async ({ page, context }) => {
  // The cookie is not HttpOnly and anyone can edit it, so an unknown value must
  // resolve to the default instead of throwing on a dynamic import of a
  // messages file that does not exist.
  await context.addCookies([{
    name: LOCALE_COOKIE,
    value: 'zz-not-a-locale',
    domain: '127.0.0.1',
    path: '/',
  }]);
  await page.goto('/account');

  await expect(page.locator('html')).toHaveAttribute('lang', 'id-ID');
  await expect(page.locator('#interfaceLanguage')).toHaveValue('id');
});

// Surface 1 of the extraction (issue #36). The entry gate is the first screen a
// guest sees, so it is the first place the interface language has to be real
// rather than a setting that changes one dropdown.
test('the entry gate reads in Indonesian by default and in English on request', async ({ page }) => {
  await page.goto('/enter');
  await expect(page.getByRole('heading', { name: 'Beri nama ruang kerja ini.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Masuk ke ruang kerja/ })).toBeVisible();
  await expect(page.getByLabel('Nama tampilan')).toBeVisible();

  await page.goto('/account');
  await page.locator('#interfaceLanguage').selectOption('en');
  await page.goto('/enter');

  await expect(page.getByRole('heading', { name: 'Put your name on this workspace.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Enter the workspace/ })).toBeVisible();
});

test('the guest-name validation message is translated, not only the static copy', async ({ page }) => {
  // Error strings are the ones a bulk extraction misses, because they are not
  // on screen when anyone looks at the page.
  await page.goto('/enter');
  await page.getByRole('button', { name: /Masuk ke ruang kerja/ }).click();
  // Scoped to the form's own alert: Next mounts a route announcer with the
  // same role, so a bare getByRole('alert') matches two elements.
  await expect(page.locator('.entry-error')).toHaveText(
    'Ketik nama yang akan dipakai di ruang kerja ini.',
  );
});

test('the landing page follows the interface language, and states its limit before its promise', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Buktiin/ })).toBeVisible();
  // The lede states what the tool is not before what it is. That negation is
  // the cheapest INV-2 compliance on the page and the most interesting line on
  // it, so it is pinned in both locales rather than merely present.
  await expect(page.locator('.production-shell__lede')).toContainText('Bukan skor');

  await page.goto('/account');
  await page.locator('#interfaceLanguage').selectOption('en');
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Prove/ })).toBeVisible();
  await expect(page.locator('.production-shell__lede')).toContainText('No score');
});

test('the landing hero and loop hold together at 390px and keep the CTA reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // Copy first when stacked: a visitor must read the sentence before the art.
  await expect(page.getByRole('heading', { name: /Buktiin/ })).toBeVisible();
  await expect(page.locator('.production-shell__loop li')).toHaveCount(4);

  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBe(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  const cta = page.locator('.production-shell__action').first();
  const box = await cta.boundingBox();
  expect(box, 'the call to action must have rendered bounds').not.toBeNull();
  expect((box?.y ?? 720) + (box?.height ?? 0)).toBeLessThanOrEqual(720);
});
