import { expect, test, type Page } from '@playwright/test';

const RUBRIC_STORAGE_KEY = 'talkactive.production.rubric.v2';
const INTERVIEW_CRITERIA = [
  {
    id: 'problem', name: 'Problem clarity', description: 'Show who is affected and why the problem is urgent.',
    requiredEvidence: ['students', 'urgency'], sourceExcerpt: null, displayOrder: 0,
  },
  {
    id: 'solution', name: 'Solution fit', description: 'Connect the rubric mechanism to an actionable retry.',
    requiredEvidence: ['rubric', 'retry'], sourceExcerpt: null, displayOrder: 1,
  },
  {
    id: 'differentiation', name: 'Differentiation', description: 'Compare the mechanism with an alternative.',
    requiredEvidence: ['competitor', 'traceable'], sourceExcerpt: null, displayOrder: 2,
  },
  {
    id: 'feasibility', name: 'Feasibility and trust', description: 'Name the prototype boundary and privacy mechanism.',
    requiredEvidence: ['prototype', 'privacy'], sourceExcerpt: null, displayOrder: 3,
  },
  {
    id: 'impact', name: 'Impact evidence', description: 'Name a measurable outcome and how it will be observed.',
    requiredEvidence: ['outcome', 'measurement'], sourceExcerpt: null, displayOrder: 4,
  },
] as const;

async function seedFiveCriterionRubric(page: Page) {
  // Store them out of sequence so the browser journey proves displayOrder,
  // rather than insertion order, owns the fixed interview progression.
  await page.addInitScript(([key, criteria]) => localStorage.setItem(
    key as string,
    JSON.stringify({ version: 2, criteria }),
  ), [RUBRIC_STORAGE_KEY, [...INTERVIEW_CRITERIA].reverse()] as const);
}

async function chooseInterview(page: Page, expectedCriterionCount?: number) {
  await page.goto('/practice');
  if (expectedCriterionCount !== undefined) {
    await expect(page.locator('.setup-rubric h3')).toHaveText(`${expectedCriterionCount} criteria`);
  }
  await page.getByRole('radio', { name: /Interview Q&A/i }).check();
  await page.getByLabel('Question and narration language').selectOption('en-US');
  await page.getByRole('button', { name: 'Start Kato interview' }).click();
  await expect(page.getByRole('heading', { name: 'Kato asks' })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBe(0);
}

test('Kato asks five fixed rubric questions and sends one answer-local final batch', async ({ page }) => {
  const requests: Array<{
    turns: Array<{
      turnId: string;
      criterion: {
        id: string;
        rubricId: string;
        name: string;
        description: string;
        requiredEvidence: string[];
        displayOrder: number;
      };
      answer: string;
      durationSeconds: number;
      answerStartMs: number;
      answerEndMs: number;
    }>;
  }> = [];
  let legacyAnalyzeRequests = 0;

  await seedFiveCriterionRubric(page);
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      contractVersion: 2,
      persistence: 'local',
      accounts: false,
      sourceDocuments: false,
      recordings: false,
      semantic: { rubric: false, evidence: true, question: true, defense: false },
    }),
  }));
  await page.route('**/api/analyze', async (route) => {
    legacyAnalyzeRequests += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/interview/analyze', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      turns: Array<{
        turnId: string;
        criterion: {
          id: string;
          rubricId: string;
          name: string;
          description: string;
          requiredEvidence: string[];
          displayOrder: number;
        };
        answer: string;
        durationSeconds: number;
        answerStartMs: number;
        answerEndMs: number;
      }>;
    };
    requests.push(body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        contractVersion: 2,
        turns: body.turns.map((turn) => ({
          turnId: turn.turnId,
          criterionId: turn.criterion.id,
          judgment: {
            verdict: 'supported',
            coverageScore: 1,
            citedSpan: turn.answer,
            missingEvidence: [],
            engine: 'semantic',
            degradedReason: null,
          },
        })),
        hardestQuestion: {
          criterionId: body.turns[4]!.criterion.id,
          questionText: 'What measured outcome would make this impact claim hardest to challenge?',
          engine: 'semantic',
        },
        mode: 'semantic',
      }),
    });
  });

  await chooseInterview(page, 5);
  const answers = [
    'Students receive feedback too late, so the urgency is losing the chance to revise.',
    'The rubric isolates one weak claim and gives the student one focused retry.',
    'Unlike a generic competitor, every verdict remains traceable to an exact answer span.',
    'The prototype keeps privacy explicit and does not require a saved camera replay.',
    'The measured outcome is whether the next answer makes the missing evidence explicit.',
  ];
  const answerBox = page.getByLabel('Your answer');
  for (let index = 0; index < answers.length - 1; index += 1) {
    const activeCriterion = page.locator('.interview-progress li[aria-current="step"]');
    await expect(activeCriterion).toHaveCount(1);
    await expect(activeCriterion).toContainText(INTERVIEW_CRITERIA[index]!.name);
    await expect(page.locator('.kato-question-copy blockquote')).toContainText(
      INTERVIEW_CRITERIA[index]!.name,
    );
    await answerBox.fill(answers[index]!);
    await page.getByRole('button', { name: 'Save answer & next question' }).click();
    expect(requests, `question ${index + 1} must not trigger final analysis`).toHaveLength(0);
    expect(legacyAnalyzeRequests).toBe(0);
    await expect(page.getByRole('heading', { name: 'Your answer evidence, mapped across the whole rubric.' })).toHaveCount(0);
  }

  await expect(page.locator('.interview-progress li[aria-current="step"]')).toContainText(
    INTERVIEW_CRITERIA[4].name,
  );
  await expect(page.locator('.kato-question-copy blockquote')).toContainText(INTERVIEW_CRITERIA[4].name);
  await answerBox.fill(answers[4]);
  await page.getByRole('button', { name: 'Submit interview for review' }).click();

  expect(requests).toHaveLength(1);
  expect(legacyAnalyzeRequests).toBe(0);
  const submitted = requests[0]!.turns;
  expect(submitted).toHaveLength(5);
  expect(submitted.map((turn) => turn.criterion.id)).toEqual(INTERVIEW_CRITERIA.map(({ id }) => id));
  expect(submitted.map((turn) => turn.answer)).toEqual(answers);
  expect(submitted.map((turn) => turn.criterion.displayOrder)).toEqual([0, 1, 2, 3, 4]);
  for (const [index, turn] of submitted.entries()) {
    expect(turn).not.toHaveProperty('questionText');
    expect(turn.criterion).not.toHaveProperty('questionText');
    expect(turn.criterion.rubricId).toBe('interview-analysis');
    expect(turn.answerStartMs).toBe(index * 45_000);
    expect(turn.answerEndMs).toBe((index + 1) * 45_000);
    expect(turn.durationSeconds).toBe(45);
  }

  await expect(page.getByRole('heading', { name: 'Your answer evidence, mapped across the whole rubric.' })).toBeVisible();
  const reviewedTurns = page.locator('.interview-turn-summary > ol[aria-label="Interview answers"] > li');
  await expect(reviewedTurns).toHaveCount(5);
  for (let index = 0; index < answers.length; index += 1) {
    const reviewedTurn = reviewedTurns.nth(index);
    await expect(reviewedTurn).toContainText(INTERVIEW_CRITERIA[index]!.name);
    await expect(reviewedTurn).toContainText(answers[index]!);
    await expect(reviewedTurn.locator('small').filter({ hasText: 'Answer window:' })).toBeVisible();
  }
  await expect(reviewedTurns.first()).toContainText(/Answer window: 0s.+45s on the single interview timeline\./u);
  await expect(reviewedTurns.last()).toContainText(/Answer window: 180s.+225s on the single interview timeline\./u);
});

test('visible question text survives narration and capture stays gated at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const observed = window as Window & { __interviewMediaRequests?: number };
    observed.__interviewMediaRequests = 0;
    class StubUtterance {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      voice = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: StubUtterance });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak() {}, getVoices() { return []; } },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          observed.__interviewMediaRequests = (observed.__interviewMediaRequests ?? 0) + 1;
          throw new Error('The test should not request media while narration is active.');
        },
      },
    });
  });
  await page.route('**/api/capabilities', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      contractVersion: 2,
      persistence: 'local',
      accounts: false,
      sourceDocuments: false,
      recordings: false,
      semantic: { rubric: false, evidence: false, question: false, defense: false },
    }),
  }));

  await chooseInterview(page);
  const question = page.locator('.kato-question-copy blockquote');
  await expect(question).toBeVisible();
  await page.getByText(/Camera \+ voice observations/i).click();
  await page.getByRole('checkbox', { name: /Local camera landmarks/i }).check();
  await expect(page.getByRole('button', { name: 'Start continuous interview capture' })).toBeEnabled();

  await page.getByRole('button', { name: 'Read question aloud' }).click();
  await expect(question).toBeVisible();
  await expect(page.locator('.studio-record')).toBeDisabled();
  expect(await page.evaluate(() => (window as Window & { __interviewMediaRequests?: number }).__interviewMediaRequests)).toBe(0);

  await page.getByRole('button', { name: 'Skip narration' }).click();
  await expect(page.getByRole('button', { name: 'Start continuous interview capture' })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
