import { expect, test, type Page } from '@playwright/test';

type ObservedPage = Page & {
  consoleErrors?: string[];
  externalRequests?: string[];
  localAssets?: Set<string>;
};

async function installMediaProbe(page: Page) {
  await page.addInitScript(() => {
    class StubSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      maxAlternatives = 1;
      onstart = null;
      onresult = null;
      onerror = null;
      onend = null;
      start() {}
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: StubSpeechRecognition,
    });

    const observedWindow = window as Window & {
      __talkActiveMediaRequests?: Array<{ audio: boolean; video: boolean }>;
    };
    const requests: Array<{ audio: boolean; video: boolean }> = [];
    observedWindow.__talkActiveMediaRequests = requests;
    if (!navigator.mediaDevices?.getUserMedia) return;

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints = {}) => {
        requests.push({
          audio: constraints.audio !== undefined && constraints.audio !== false,
          video: constraints.video !== undefined && constraints.video !== false,
        });
        return originalGetUserMedia(constraints);
      },
    });
  });
}

async function observedMediaRequests(page: Page) {
  return page.evaluate(() => (
    window as Window & {
      __talkActiveMediaRequests?: Array<{ audio: boolean; video: boolean }>;
    }
  ).__talkActiveMediaRequests ?? []);
}

async function openMultimodalAttempt(page: Page) {
  await page.goto('/practice');
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await page.getByRole('tab', { name: /Camera \+ voice/i }).click();
  await expect(page.getByRole('heading', { name: 'Rehearse the whole performance.' })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          element: element.id
            ? `${element.tagName.toLocaleLowerCase()}#${element.id}`
            : `${element.tagName.toLocaleLowerCase()}.${[...element.classList].join('.')}`,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          width: Math.round(bounds.width),
        };
      })
      .filter(({ left, right, width }) => width > 0 && (left < -1 || right > viewportWidth + 1))
      .sort((left, right) => right.right - left.right)
      .slice(0, 8);
    return {
      overflow: document.documentElement.scrollWidth - viewportWidth,
      offenders,
    };
  });
  expect(layout).toEqual({ overflow: 0, offenders: [] });
}

test.beforeEach(async ({ page }, testInfo) => {
  const observedPage = page as ObservedPage;
  const configuredBaseUrl = testInfo.project.use.baseURL;
  const localOrigin = typeof configuredBaseUrl === 'string'
    ? new URL(configuredBaseUrl).origin
    : 'http://127.0.0.1:4183';
  observedPage.consoleErrors = [];
  observedPage.externalRequests = [];
  observedPage.localAssets = new Set<string>();
  page.on('console', (message) => {
    if (message.type() === 'error') observedPage.consoleErrors?.push(message.text());
  });
  page.on('pageerror', (error) => observedPage.consoleErrors?.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === localOrigin) observedPage.localAssets?.add(url.pathname);
    if ((url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin !== localOrigin) {
      observedPage.externalRequests?.push(request.url());
    }
  });
  await installMediaProbe(page);
});

test.afterEach(async ({ page }) => {
  const observedPage = page as ObservedPage;
  expect(observedPage.consoleErrors ?? []).toEqual([]);
  expect(observedPage.externalRequests ?? []).toEqual([]);
});

test('multimodal media stays off until Start and each consent is independent at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMultimodalAttempt(page);

  const cameraConsent = page.getByRole('checkbox', { name: /Local camera landmarks/i });
  const acousticConsent = page.getByRole('checkbox', { name: /Local acoustic observations/i });
  const dictationConsent = page.getByRole('checkbox', { name: /Browser dictation/i });
  const start = page.getByRole('button', { name: 'Start selected capture' });

  await expect(cameraConsent).not.toBeChecked();
  await expect(acousticConsent).not.toBeChecked();
  await expect(dictationConsent).not.toBeChecked();
  await expect(dictationConsent).toBeEnabled();
  await expect(start).toBeDisabled();
  await expect(page.getByText('No media access before Start', { exact: true })).toBeVisible();
  expect(await observedMediaRequests(page)).toEqual([]);

  await cameraConsent.check();
  await expect(cameraConsent).toBeChecked();
  await expect(acousticConsent).not.toBeChecked();
  await expect(start).toBeEnabled();
  expect(await observedMediaRequests(page)).toEqual([]);

  await acousticConsent.check();
  await expect(cameraConsent).toBeChecked();
  await expect(acousticConsent).toBeChecked();
  await cameraConsent.uncheck();
  await expect(cameraConsent).not.toBeChecked();
  await expect(acousticConsent).toBeChecked();
  await dictationConsent.check();
  await expect(cameraConsent).not.toBeChecked();
  await expect(acousticConsent).toBeChecked();
  await expect(dictationConsent).toBeChecked();
  expect(await observedMediaRequests(page)).toEqual([]);

  await expectNoHorizontalOverflow(page);
});

test('camera-only capture renders observations and a fully disclosed summary at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMultimodalAttempt(page);
  await page.getByLabel('Practice transcript').fill(
    'Um, our problem affects students and our evidence shows urgency. '
    + 'Our rubric feedback keeps every claim traceable. '
    + 'We built a feasible prototype architecture with explicit privacy limitations.',
  );

  await page.getByRole('checkbox', { name: /Local camera landmarks/i }).check();
  await page.getByRole('button', { name: 'Start selected capture' }).click();
  const finishCapture = page.getByRole('button', { name: 'Finish & assemble review', exact: true });
  await expect(finishCapture).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_200);

  const landmarkCanvas = page.locator('.studio-stage canvas');
  await expect(landmarkCanvas).toBeVisible();

  await finishCapture.click();
  await expect(page.locator('.studio-status')).toContainText('Rehearsal captured');
  await expect(page.locator('.studio-hud')).toContainText(/find the camera frame/i);

  // Canvas pixels are deliberately not asserted here. drawOverlay clears the
  // whole canvas on every frame before it draws, and Chrome's synthetic camera
  // has no face or body in it, so the surface is empty throughout a headless
  // run: painting it from the test only races the next frame. The property that
  // matters — the landmark canvas is scrubbed when a capture ends — is asserted
  // directly against clearRect in test/raw-observation-retention.test.mjs.

  expect(await observedMediaRequests(page)).toEqual([{ audio: false, video: true }]);
  expect([...(page as ObservedPage).localAssets ?? []]).toContain(
    '/mediapipe/models/pose_landmarker_lite.task',
  );

  await page.getByRole('button', { name: /Review this attempt/i }).click();
  const review = page.locator('.multimodal-review');
  await expect(review).toBeVisible();
  await expect(review.getByRole('heading', { name: 'How the attempt came across' })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Voice evidence' })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Camera evidence' })).toBeVisible();
  await expect(review.getByText(/not emotion, confidence, health, skill, or hiring suitability/i)).toBeVisible();
  // A summary figure is allowed, but only while a judge can take it apart. Each
  // clause below is one of the conditions AD-9 puts on showing the number at all.
  const summary = review.locator('.overall-grade');
  await expect(summary).toHaveCount(1);
  await expect(summary.getByText('Overall rehearsal', { exact: true })).toBeVisible();
  await expect(review.getByText('50% rubric substance · 25% vocal signals · 25% visual signals')).toBeVisible();
  await expect(review.getByText(/describes one rehearsal attempt, not your ability/i)).toBeVisible();
  await expect(review.getByText(/excluded from the mean rather than counted as zero/i)).toBeVisible();
  for (const component of ['Substance', 'Vocal delivery', 'Visual delivery']) {
    await expect(review.locator('.performance-score-grid').getByText(component, { exact: true })).toBeVisible();
  }
  // The number never gets to call itself a verdict on the person. Scoped to the
  // figure's own label: the boundary paragraph says these words on purpose, to
  // deny them.
  expect(await summary.innerText()).not.toMatch(/\b(ability|confidence|skill|grade)\b/iu);

  const reviewBox = await review.boundingBox();
  expect(reviewBox, 'the local-observation review must have rendered bounds').not.toBeNull();
  expect(reviewBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((reviewBox?.x ?? 0) + (reviewBox?.width ?? 391)).toBeLessThanOrEqual(390);
  await expectNoHorizontalOverflow(page);
});
