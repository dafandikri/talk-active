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
