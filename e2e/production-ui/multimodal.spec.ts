import { expect, test, type Page } from '@playwright/test';

import type {
  CapabilitiesResponse,
  StatelessRejudgeRequest,
  StatelessRejudgeResponse,
} from '../../apps/web/lib/contracts.ts';
import type { StoredRubricCriterion } from '../../apps/web/lib/rubric-storage.ts';

const RETAKE_RUBRIC = [
  {
    id: 'problem-clarity',
    name: 'Problem clarity',
    description: 'Identify who is affected.',
    requiredEvidence: ['problem', 'students'],
    sourceExcerpt: null,
    displayOrder: 0,
  },
  {
    id: 'impact-proof',
    name: 'Impact proof',
    description: 'Provide pilot evidence and measured improvement.',
    requiredEvidence: ['pilot evidence', 'measured improvement'],
    sourceExcerpt: null,
    displayOrder: 1,
  },
] satisfies StoredRubricCriterion[];

const STALE_QUESTION_RUBRIC = [
  ...RETAKE_RUBRIC,
  {
    id: 'feasibility-proof',
    name: 'Feasibility proof',
    description: 'Explain the architecture and privacy boundary.',
    requiredEvidence: ['architecture', 'privacy'],
    sourceExcerpt: null,
    displayOrder: 2,
  },
] satisfies StoredRubricCriterion[];

const LOCAL_DETERMINISTIC_CAPABILITIES = {
  contractVersion: 2,
  persistence: 'local',
  accounts: false,
  sourceDocuments: false,
  recordings: false,
  semantic: {
    rubric: false,
    evidence: false,
    question: false,
    defense: false,
    coach: false,
  },
} satisfies CapabilitiesResponse;

const RETAKE_ORIGINAL = 'The problem affects students.';
const RETAKE_ADDITION = 'Our pilot evidence compares one cohort before and after the rehearsal.';
const RETAKE_MARKED = `${RETAKE_ORIGINAL}\n\n[Tambahan · Impact proof] ${RETAKE_ADDITION}`;

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
      __talkActiveMediaTrackStops?: number;
    };
    const requests: Array<{ audio: boolean; video: boolean }> = [];
    observedWindow.__talkActiveMediaRequests = requests;
    observedWindow.__talkActiveMediaTrackStops = 0;
    if (!navigator.mediaDevices?.getUserMedia) return;

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints = {}) => {
        requests.push({
          audio: constraints.audio !== undefined && constraints.audio !== false,
          video: constraints.video !== undefined && constraints.video !== false,
        });
        const stream = await originalGetUserMedia(constraints);
        for (const track of stream.getTracks()) {
          const originalStop = track.stop.bind(track);
          Object.defineProperty(track, 'stop', {
            configurable: true,
            value: () => {
              observedWindow.__talkActiveMediaTrackStops = (
                observedWindow.__talkActiveMediaTrackStops ?? 0
              ) + 1;
              originalStop();
            },
          });
        }
        return stream;
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

async function observedMediaTrackStops(page: Page) {
  return page.evaluate(() => (
    window as Window & { __talkActiveMediaTrackStops?: number }
  ).__talkActiveMediaTrackStops ?? 0);
}

async function openMultimodalAttempt(page: Page) {
  await page.goto('/practice');
  await page.getByRole('button', { name: /Mulai percobaan ini/i }).click();
  await expect(page.locator('.capture-header h2')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  // The attempt opens on writing, so the capture panel is not merely idle —
  // it is not on the page at all until the user asks for it.
  await expect(page.getByRole('heading', { name: 'Latih keseluruhan penampilan.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rekam langsung' }).click();
  await expect(page.getByRole('heading', { name: 'Latih keseluruhan penampilan.' })).toBeVisible();
}

async function seedRetakeRubric(
  page: Page,
  criteria: readonly StoredRubricCriterion[] = RETAKE_RUBRIC,
) {
  await page.addInitScript(([key, storedCriteria]) => localStorage.setItem(
    key as string,
    JSON.stringify({ version: 2, criteria: storedCriteria }),
  ), ['talkactive.production.rubric.v2', criteria] as const);
}

async function mockLocalCapabilities(page: Page) {
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(LOCAL_DETERMINISTIC_CAPABILITIES),
  }));
}

async function finishAudioCaptureReview(page: Page, transcript: string) {
  await openMultimodalAttempt(page);
  await page.getByLabel('Transkrip latihan').fill(transcript);
  await page.getByRole('checkbox', { name: /Suara isyarat lokal/i }).check();
  await page.getByRole('button', { name: 'Mulai latihan' }).click();
  const finishCapture = page.getByRole('button', {
    name: 'Selesai & rakit tinjauan',
    exact: true,
  });
  await expect(finishCapture).toBeVisible();
  await finishCapture.click();
  await expect(page.locator('.studio-status')).toContainText('Latihan terekam');
  await page.getByRole('button', { name: /Tinjau percobaan ini/i }).click();
  await expect(page.locator('[data-practice-stage="review"]')).toHaveCount(1);
}

async function enterPracticeThroughClientNavigation(page: Page) {
  await page.goto('/workspace');
  const practiceLink = page.locator('.main-nav a[href^="/practice"]');
  await expect(practiceLink).toHaveCount(1);
  await practiceLink.click();
  await expect(page).toHaveURL(/\/practice(?:\?|$)/u);
  await expect(page.getByRole('heading', { name: 'Anda sedang bersiap untuk apa?' })).toBeVisible();
}

async function enableEveryCaptureChoice(page: Page) {
  await page.getByRole('checkbox', { name: /Kamera landmark lokal/i }).check();
  await page.getByRole('checkbox', { name: /Suara isyarat lokal/i }).check();
  await page.getByRole('checkbox', { name: /Transkrip langsung/i }).check();
  await page.getByRole('checkbox', { name: /Simpan rekaman kamera \+ mikrofon/i }).check();
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

test('presentation capture can request devices after client navigation without a refresh', async ({ page }) => {
  await enterPracticeThroughClientNavigation(page);
  await page.getByRole('button', { name: /Mulai percobaan ini/i }).click();
  await page.getByRole('button', { name: 'Rekam langsung' }).click();
  await enableEveryCaptureChoice(page);
  await page.getByRole('button', { name: 'Mulai latihan' }).click();

  // Reaching calibration proves getUserMedia resolved. The pose model may
  // still be loading, which is independent of the permission regression.
  await expect(page.locator('.studio-status')).toContainText('Mengalibrasi selama 3 detik');
  expect(await observedMediaRequests(page)).toEqual([{ audio: true, video: true }]);
});

test('interview capture can request devices after client navigation without a refresh', async ({ page }) => {
  await enterPracticeThroughClientNavigation(page);
  await page.getByRole('radio', { name: /Tanya jawab wawancara/i }).check();
  await page.getByRole('button', { name: 'Mulai wawancara Kato' }).click();
  await enableEveryCaptureChoice(page);
  await page.getByRole('button', { name: 'Mulai perekaman wawancara berkelanjutan' }).click();

  // This status is only set AFTER `await vision.start()` resolves, and that
  // call loads the vision model. Playwright's default 5s expect budget is a
  // race against a model load, which is why this failed about half the time.
  // The assertion is unchanged; only the patience is.
  await expect(page.locator('.studio-status'))
    .toContainText('dijeda sampai jawaban pertama dimulai', { timeout: 20_000 });
  expect(await observedMediaRequests(page)).toEqual([{ audio: true, video: true }]);
});

test('multimodal media stays off until Start and each consent is independent at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMultimodalAttempt(page);

  const cameraConsent = page.getByRole('checkbox', { name: /Kamera landmark lokal/i });
  const acousticConsent = page.getByRole('checkbox', { name: /Suara isyarat lokal/i });
  const dictationConsent = page.getByRole('checkbox', { name: /Transkrip langsung Bahasa Indonesia/i });
  const replayConsent = page.getByRole('checkbox', { name: /Simpan rekaman kamera \+ mikrofon/i });
  const start = page.getByRole('button', { name: 'Mulai latihan' });

  await expect(cameraConsent).not.toBeChecked();
  await expect(acousticConsent).not.toBeChecked();
  await expect(dictationConsent).not.toBeChecked();
  await expect(replayConsent).not.toBeChecked();
  await expect(dictationConsent).toBeEnabled();
  await expect(start).toBeDisabled();
  await expect(page.getByText('Tidak ada akses media sebelum Mulai', { exact: true })).toBeVisible();
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
  await replayConsent.check();
  await expect(replayConsent).toBeChecked();
  await expect(cameraConsent).not.toBeChecked();
  await replayConsent.uncheck();
  expect(await observedMediaRequests(page)).toEqual([]);

  await expectNoHorizontalOverflow(page);
});

test('Mansiz presentation auto-stops once at the configured bell and carries the limit into review', async ({ page }) => {
  await openMultimodalAttempt(page);
  await page.getByLabel('Transkrip latihan').fill(
    'Our problem affects students, and our evidence shows urgency. '
    + 'Rubric feedback makes every claim traceable and gives the presenter a focused retry. '
    + 'The prototype is feasible because its privacy boundary is explicit.',
  );
  await page.getByLabel('Batas waktu').fill('1');
  await page.getByRole('checkbox', { name: /Suara isyarat lokal/i }).check();

  // Install after hydration but before capture so the session origin and bell
  // share one monotonic clock without delaying the production page boot.
  const captureOrigin = new Date('2026-08-13T12:00:00.000Z');
  await page.clock.install({ time: captureOrigin });
  await page.clock.pauseAt(captureOrigin);
  await page.getByRole('button', { name: 'Mulai latihan' }).click();

  const finishCapture = page.getByRole('button', {
    name: 'Selesai & rakit tinjauan',
    exact: true,
  });
  await expect(finishCapture).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Perekaman berhenti otomatis pada 01:00, seperti penilai menghentikan presentasi tepat waktu. Selesaikan lebih awal kapan pun sudah selesai.',
  );
  await expect(page.locator('.studio-live')).toContainText('tersisa');
  expect(await observedMediaRequests(page)).toEqual([{ audio: true, video: false }]);

  await page.clock.fastForward('01:00');
  await expect(finishCapture).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mulai latihan' })).toBeVisible();
  await expect(page.locator('.studio-status')).toContainText(
    'Waktu habis dan perekaman berhenti sendiri, persis seperti yang dilakukan penilai.',
  );
  await expect(page.getByLabel('Panjang bicara')).toHaveValue('60');
  await expect.poll(() => observedMediaTrackStops(page)).toBe(1);

  // A later timer turn must not complete or release the same capture again.
  await page.clock.fastForward(1_000);
  expect(await observedMediaTrackStops(page)).toBe(1);
  await expect(page.locator('.studio-status')).toContainText(
    'Waktu habis dan perekaman berhenti sendiri, persis seperti yang dilakukan penilai.',
  );

  await page.getByRole('button', { name: /Tinjau percobaan ini/i }).click();
  const review = page.locator('.multimodal-review');
  await expect(review).toBeVisible();
  await expect(review.locator('.timeline-duration')).toContainText('total 01:00 · batas 01:00');
  await expect(review.getByRole('note')).toContainText(/00:00.*batas 01:00/iu);
  await expect(page.locator('[data-practice-stage="review"]')).toHaveCount(1);
  expect(await observedMediaTrackStops(page)).toBe(1);
});

test('one missing presentation criterion accepts a marked addition without changing settled evidence', async ({ page }) => {
  await seedRetakeRubric(page);
  await mockLocalCapabilities(page);
  const rejudgeRequests: StatelessRejudgeRequest[] = [];
  const response = {
    contractVersion: 2,
    judgment: {
      criterionId: 'impact-proof',
      verdict: 'partial',
      coverageScore: 0.5,
      citedSpan: RETAKE_ADDITION,
      missingEvidence: ['measured improvement'],
      engine: 'semantic',
      degradedReason: null,
    },
    questionTargetCriterionId: 'impact-proof',
    questionText: 'Berapa peningkatan terukur yang dihasilkan bukti pilot tersebut?',
    questionEngine: 'semantic',
    mode: 'semantic',
  } satisfies StatelessRejudgeResponse;
  await page.route('**/api/rejudge', async (route) => {
    rejudgeRequests.push(route.request().postDataJSON() as StatelessRejudgeRequest);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await finishAudioCaptureReview(page, RETAKE_ORIGINAL);

  const problem = page.locator('#evidence-problem-clarity');
  const impact = page.locator('#evidence-impact-proof');
  await expect(page.locator('.coverage-gauge strong')).toHaveText('50%');
  await expect(problem).toHaveAttribute('data-evidence', 'found');
  await expect(problem.locator('.evidence-quote-text')).toHaveText(RETAKE_ORIGINAL);
  await expect(impact).toHaveAttribute('data-evidence', 'absent');

  const target = page.locator('.review-retake-strip li').filter({ hasText: 'Impact proof' });
  await expect(target).toHaveCount(1);
  await target.getByRole('button', { name: 'Rekam tambahan' }).click();

  await expect(page.locator('[data-practice-stage="attempt"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Tulis atau tempel' }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Transkrip latihan')).toHaveValue(RETAKE_ORIGINAL);
  const addition = page.locator('#retakeDraft');
  await expect(addition).toHaveValue('');
  await addition.fill(RETAKE_ADDITION);
  await page.getByRole('button', { name: 'Tambahkan dan nilai ulang kriteria ini' }).click();

  await expect(page.locator('[data-practice-stage="review"]')).toHaveCount(1);
  await expect(page.locator('.coverage-gauge strong')).toHaveText('75%');
  await expect(problem).toHaveAttribute('data-evidence', 'found');
  await expect(problem.locator('.evidence-quote-text')).toHaveText(RETAKE_ORIGINAL);
  await expect(impact).toHaveAttribute('data-evidence', 'found');
  await expect(impact.locator('.evidence-quote-text')).toHaveText(RETAKE_ADDITION);
  await expect(page.locator('.weakness-card h3')).toHaveText('Impact proof');
  await expect(page.locator('.judge-preview blockquote')).toHaveText(response.questionText);
  // The sensor summary described the original take, not the amended transcript.
  await expect(page.locator('.multimodal-review')).toHaveCount(0);

  expect(rejudgeRequests).toEqual([{
    transcript: RETAKE_MARKED,
    criterion: {
      id: 'impact-proof',
      rubricId: 'stateless-analysis',
      name: 'Impact proof',
      description: 'Provide pilot evidence and measured improvement.',
      requiredEvidence: ['pilot evidence', 'measured improvement'],
      displayOrder: 1,
    },
    rejected: {
      verdict: 'unsupported',
      coverageScore: 0,
      citedSpan: null,
      missingEvidence: ['pilot evidence', 'measured improvement'],
      engine: 'deterministic',
    },
    language: 'id-ID',
  }]);

  await page.getByRole('button', { name: 'Perbaiki transkrip' }).click();
  await expect(page.getByLabel('Transkrip latihan')).toHaveValue(RETAKE_MARKED);
});

test('an addition beyond the transcript limit preserves the draft and original capture', async ({ page }) => {
  await seedRetakeRubric(page);
  await mockLocalCapabilities(page);
  const original = RETAKE_ORIGINAL.padEnd(11_980, 'x');
  let rejudgeRequests = 0;
  await page.route('**/api/rejudge', async (route) => {
    rejudgeRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        contractVersion: 2,
        judgment: {
          criterionId: 'impact-proof',
          verdict: 'partial',
          coverageScore: 0.5,
          citedSpan: RETAKE_ADDITION,
          missingEvidence: ['measured improvement'],
          engine: 'semantic',
          degradedReason: null,
        },
        questionTargetCriterionId: 'impact-proof',
        questionText: 'Berapa peningkatan terukur yang dihasilkan bukti pilot tersebut?',
        questionEngine: 'semantic',
        mode: 'semantic',
      } satisfies StatelessRejudgeResponse),
    });
  });

  await finishAudioCaptureReview(page, original);
  const target = page.locator('.review-retake-strip li').filter({ hasText: 'Impact proof' });
  await target.getByRole('button', { name: 'Rekam tambahan' }).click();
  const addition = page.locator('#retakeDraft');
  await addition.fill(RETAKE_ADDITION);
  await page.getByRole('button', { name: 'Tambahkan dan nilai ulang kriteria ini' }).click();

  await expect(page.locator('.criterion-retake-panel').getByRole('alert'))
    .toContainText(/12[.]?000/u);
  await expect(page.locator('[data-practice-stage="attempt"]')).toHaveCount(1);
  await expect(page.getByLabel('Transkrip latihan')).toHaveValue(original);
  await expect(addition).toHaveValue(RETAKE_ADDITION);
  expect(rejudgeRequests).toBe(0);

  await page.getByRole('button', { name: 'Batalkan tambahan ini' }).click();
  await page.goForward();
  await expect(page.locator('[data-practice-stage="review"]')).toHaveCount(1);
  await expect(page.locator('.multimodal-review')).toBeVisible();
});

test('repairing the weakest criterion retargets the judge question to the new weakest gap', async ({ page }) => {
  await seedRetakeRubric(page, STALE_QUESTION_RUBRIC);
  await mockLocalCapabilities(page);
  const original = 'The problem affects students. Our architecture is documented.';
  const addition = 'Our pilot evidence measured improvement for 24 students.';
  const staleQuestion = 'How many students did the impact pilot improve?';
  await page.route('**/api/rejudge', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      contractVersion: 2,
      judgment: {
        criterionId: 'impact-proof',
        verdict: 'supported',
        coverageScore: 1,
        citedSpan: addition,
        missingEvidence: [],
        engine: 'semantic',
        degradedReason: null,
      },
      questionTargetCriterionId: 'impact-proof',
      questionText: staleQuestion,
      questionEngine: 'semantic',
      mode: 'semantic',
    } satisfies StatelessRejudgeResponse),
  }));

  await finishAudioCaptureReview(page, original);
  await expect(page.locator('.weakness-card h3')).toHaveText('Impact proof');
  const target = page.locator('.review-retake-strip li').filter({ hasText: 'Impact proof' });
  await target.getByRole('button', { name: 'Rekam tambahan' }).click();
  await page.locator('#retakeDraft').fill(addition);
  await page.getByRole('button', { name: 'Tambahkan dan nilai ulang kriteria ini' }).click();

  await expect(page.locator('[data-practice-stage="review"]')).toHaveCount(1);
  await expect(page.locator('.coverage-gauge strong')).toHaveText('83%');
  await expect(page.locator('.weakness-card h3')).toHaveText('Feasibility proof');
  await expect(page.locator('.weakness-card')).toContainText('privacy');
  const judgeQuestion = page.locator('.judge-preview blockquote');
  await expect(judgeQuestion).toContainText('Feasibility proof');
  await expect(judgeQuestion).toContainText('privacy');
  await expect(judgeQuestion).not.toHaveText(staleQuestion);
  await expect(page.locator('.evidence-analysis-mode')).toContainText(
    'Karena kriteria terlemah berubah setelah penilaian ulang, pertanyaan juri dan latihan fokusnya dibuat ulang dengan pencocokan isyarat deterministik.',
  );
});

test('camera-only capture renders concise observations with fully disclosed detail at 390px', async ({ page }) => {
  // This one really does load the vendored MediaPipe WASM and pose model, then
  // drives a fake camera through calibration. It lands within a second or two
  // of the default budget on a warm machine and over it on a cold one, and a
  // gate that fails on the demo laptop's mood is not a gate.
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await openMultimodalAttempt(page);
  await page.getByLabel('Transkrip latihan').fill(
    'Um, our problem affects students and our evidence shows urgency. '
    + 'Our rubric feedback keeps every claim traceable. '
    + 'We built a feasible prototype architecture with explicit privacy limitations.',
  );

  await page.getByRole('checkbox', { name: /Kamera landmark lokal/i }).check();
  await page.getByRole('button', { name: 'Mulai latihan' }).click();
  const finishCapture = page.getByRole('button', { name: 'Selesai & rakit tinjauan', exact: true });
  await expect(finishCapture).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_200);

  const landmarkCanvas = page.locator('.studio-stage canvas');
  await expect(landmarkCanvas).toBeVisible();

  await finishCapture.click();
  await expect(page.locator('.studio-status')).toContainText('Latihan terekam');
  await expect(page.locator('.studio-hud')).toContainText(/cari bingkai kamera/i);

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

  await page.getByRole('button', { name: /Tinjau percobaan ini/i }).click();
  await expect(page.locator('.review-hero h2')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const review = page.locator('.multimodal-review');
  await expect(review).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Periksa momen-momen yang mungkin perlu dilihat lagi.' })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Rubrik, suara, dan kamera dalam satu jam yang sama' })).toBeVisible();
  await expect(review.getByText(/tidak mengukur rasa percaya diri.*kesehatan.*kelayakan kerja/i)).toBeVisible();

  // Dense readings are still present, but no longer compete with rubric proof
  // and the one synchronized timeline before the user asks to inspect them.
  const fullReading = review.locator('.review-full-reading');
  await expect(fullReading.locator('.reading-total')).not.toBeVisible();
  await fullReading.locator('summary').click();
  await expect(review.getByRole('heading', { name: 'Pembacaan suara' })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Pembacaan kamera' })).toBeVisible();
  // A summary figure is allowed, but only while a judge can take it apart. Each
  // clause below is one of the conditions AD-9 puts on showing the number at all.
  const summary = review.locator('.reading-total');
  await expect(summary).toHaveCount(1);
  await expect(summary.getByText('latihan ini', { exact: true })).toBeVisible();
  await expect(review.getByText(/menggambarkan satu percobaan latihan, bukan kemampuan Anda/i)).toBeVisible();
  await expect(review.getByText(/dikeluarkan dari rata-rata, bukan dihitung nol/i)).toBeVisible();

  // This assertion used to pin the literal sentence
  // "50% rubric substance · 25% vocal signals · 25% visual signals" — and it
  // passed while being FALSE on this very run. Chrome's synthetic camera has no
  // face in it, so tracking never clears the 80% floor, the visual reading is
  // excluded, and the vocal reading actually carries half the figure. The screen
  // claimed a quarter of the number came from a signal that contributed nothing.
  //
  // So the property, not the sentence: the caption must describe the arithmetic
  // that produced the number beside it.
  const weighting = review.locator('.reading-weighting');
  await expect(weighting).toBeVisible();
  const weightingText = (await weighting.innerText()).trim();
  const statedShares = [...weightingText.matchAll(/(\d+)%/gu)].map((match) => Number(match[1]));
  expect(statedShares.length, `the weighting must name each share: "${weightingText}"`)
    .toBeGreaterThan(0);
  expect(statedShares.reduce((sum, share) => sum + share, 0),
    `the printed weighting must account for the whole figure: "${weightingText}"`).toBe(100);

  // One drawn block per share named, each as wide as the share it carried.
  const segments = review.locator('.reading-segment');
  await expect(segments).toHaveCount(statedShares.length);
  const barWidth = (await review.locator('.reading-bar').boundingBox())?.width ?? 0;
  expect(barWidth).toBeGreaterThan(0);
  for (let index = 0; index < statedShares.length; index += 1) {
    const box = await segments.nth(index).boundingBox();
    const drawnShare = ((box?.width ?? 0) / barWidth) * 100;
    expect(Math.abs(drawnShare - statedShares[index]),
      `block ${index} is drawn at ${drawnShare.toFixed(1)}% but labelled ${statedShares[index]}%`)
      .toBeLessThan(4);
  }

  // A signal that was excluded must be named beside the number, not omitted —
  // and must not still appear in the weighting as though it counted.
  const excluded = review.locator('.reading-unmeasured li');
  for (let index = 0; index < await excluded.count(); index += 1) {
    const entry = (await excluded.nth(index).innerText()).toLowerCase();
    const signal = entry.includes('visual') ? 'visual' : 'vocal';
    expect(weightingText.toLowerCase(),
      `"${signal}" was reported unmeasured yet still claims a share of the figure`)
      .not.toContain(`${signal} signals`);
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
