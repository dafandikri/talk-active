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
  await page.getByLabel('Project language').selectOption('en-US');
  await page.getByRole('button', { name: 'Start Kato interview' }).click();
  await expect(page.getByRole('heading', { name: 'Kato asks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Answer one rubric question at a time.' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
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
    const nextQuestion = page.locator('.kato-question-copy blockquote');
    await expect(nextQuestion).toContainText(INTERVIEW_CRITERIA[index + 1]!.name);
    await expect(nextQuestion).toHaveAccessibleName(
      new RegExp(`^Question ${index + 2} of ${INTERVIEW_CRITERIA.length}:`),
    );
    await expect(nextQuestion).toBeFocused();
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
  // `expect(array)` does not retry, so asserting the recorded request straight
  // after the click was a race against the submit that had only just started —
  // it won on an idle machine and lost sixty tests into the suite. The review
  // heading renders only once the batch response has been applied, so waiting
  // for it makes the count deterministic without weakening what it asserts:
  // exactly one request, never one per question.
  await expect(page.getByRole('heading', { name: 'Your answer evidence, mapped across the whole rubric.' })).toBeVisible();

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
  const turnDisclosure = page.locator('.interview-turn-summary');
  await expect(turnDisclosure.locator('summary')).toContainText('5 answers');
  await turnDisclosure.locator('summary').click();
  const reviewedTurns = turnDisclosure.locator('ol[aria-label="Interview answers"] > li');
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

test('a signed-in interview summary survives synced progress reload without duplicating a presentation', async ({ page }) => {
  const projectId = 'project-interview-progress';
  const rubricId = 'rubric-interview-progress';
  const presentationAttemptId = 'attempt-synced-presentation';
  const createdAt = '2026-08-12T08:00:00.000Z';
  const criterion = {
    id: 'criterion-interview-progress',
    rubricId,
    name: 'Traceable impact',
    description: 'Name a measurable outcome and how it will be observed.',
    requiredEvidence: ['outcome', 'measurement'],
    displayOrder: 0,
  };

  // The presentation happy path writes a browser mirror after persisting the
  // server attempt. Its shared ID must collapse to one row once sync loads.
  // The later interview has no server attempt row and must remain alongside it.
  await page.addInitScript(([key, session]) => {
    if (!localStorage.getItem(key as string)) {
      localStorage.setItem(key as string, JSON.stringify([session]));
    }
  }, ['talkactive.production.sessions.v1', {
    id: presentationAttemptId,
    createdAt,
    evidenceScore: 50,
    weakest: 'Traceable impact',
    defenseStatus: null,
    projectId,
    projectTitle: 'Signed-in interview project',
    projectLanguage: 'en-US',
    criteria: [],
  }] as const);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (url.pathname === '/api/capabilities') return respond({
      contractVersion: 2,
      persistence: 'neon',
      accounts: true,
      sourceDocuments: false,
      recordings: false,
      semantic: { rubric: false, evidence: true, question: false, defense: false, coach: false },
    });
    if (url.pathname === '/api/projects' && request.method() === 'GET') return respond({
      contractVersion: 2,
      identity: 'account',
      projects: [{
        project: {
          id: projectId,
          userId: 'interview-progress-owner',
          title: 'Signed-in interview project',
          language: 'en-US',
          eventContext: 'Judge interview',
          deadline: '2026-08-14',
          createdAt,
          updatedAt: createdAt,
        },
        attemptCount: 1,
        lastAttemptAt: createdAt,
        rubricConfirmed: true,
      }],
    });
    if (url.pathname === `/api/projects/${projectId}` && request.method() === 'GET') return respond({
      contractVersion: 2,
      workspace: {
        project: {
          id: projectId,
          userId: 'interview-progress-owner',
          title: 'Signed-in interview project',
          language: 'en-US',
          eventContext: 'Judge interview',
          deadline: '2026-08-14',
          createdAt,
          updatedAt: createdAt,
        },
        rubric: { id: rubricId, projectId, sourceType: 'manual', confirmedAt: createdAt, createdAt },
        criteria: [criterion],
        sourceDocuments: [],
      },
    });
    if (url.pathname === '/api/interview/analyze' && request.method() === 'POST') {
      const body = request.postDataJSON() as { turns: Array<{ turnId: string; criterion: { id: string }; answer: string }> };
      const turn = body.turns[0]!;
      return respond({
        contractVersion: 2,
        turns: [{
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
        }],
        hardestQuestion: {
          criterionId: turn.criterion.id,
          questionText: 'How will that outcome be measured after the rehearsal?',
          engine: 'semantic',
        },
        mode: 'semantic',
      });
    }
    if (url.pathname === `/api/progress/${projectId}` && request.method() === 'GET') return respond({
      contractVersion: 2,
      projectId,
      attempts: [{
        attemptId: presentationAttemptId,
        createdAt,
        coverage: 0.75,
        hasDeliveryReview: false,
        recordingStatus: null,
      }],
      recurringWeaknesses: [],
      attemptComparisons: [],
    });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`/practice?project=${projectId}`);
  await expect(page.locator('.setup-project-summary strong')).toHaveText('Signed-in interview project');
  await page.getByRole('radio', { name: /Interview Q&A/i }).check();
  await page.getByRole('button', { name: 'Start Kato interview' }).click();
  await page.getByLabel('Your answer').fill(
    'The measurable outcome is explicit rubric coverage, and the measurement is the saved criterion verdict.',
  );
  await page.getByRole('button', { name: 'Submit interview for review' }).click();
  await expect(page.getByRole('heading', { name: 'Your answer evidence, mapped across the whole rubric.' })).toBeVisible();
  await page.getByRole('button', { name: 'Save interview review' }).click();

  await expect(page).toHaveURL(`/progress?project=${projectId}`);
  // An interview aggregate averages five answer-local verdicts; a presentation
  // coverage reads one continuous transcript. One line through both would draw
  // a delta between two different measurements, so the trend keeps the latest
  // format only and labels itself. Both attempts still appear in the archive.
  await expect(page.locator('.coverage-trend-dot')).toHaveCount(1);
  await expect(page.locator('.progress-chart-card .session-status')).toHaveText('Interview answer aggregates only');
  await expect(page.locator('.full-session-list .session-row')).toHaveCount(2);
  await expect(page.locator('.browser-only-session')).toHaveCount(1);
  await expect(page.locator('.browser-only-session')).toContainText('Interview answer aggregate');
  await expect(page.locator('.browser-only-session .session-status')).toHaveText('browser only');
  await expect(page.locator('.progress-stats article').filter({ hasText: 'Sessions' }).locator('strong')).toHaveText('2');
  await expect(page.locator('.attempt-diff-card')).toContainText('Save two reviewed attempts');
  await expect(page.locator('.recurring-card .session-status')).toHaveText('Synced SQL history');
  await expect(page.locator('.production-boundary-note')).toContainText(
    'Recurring gaps and exact attempt comparisons use synced verdict rows only',
  );

  // The saved interview aggregate and the dedupe identity both live in browser
  // storage, so a client-side transition alone is not enough evidence.
  await page.reload();
  await expect(page).toHaveURL(`/progress?project=${projectId}`);
  // An interview aggregate averages five answer-local verdicts; a presentation
  // coverage reads one continuous transcript. One line through both would draw
  // a delta between two different measurements, so the trend keeps the latest
  // format only and labels itself. Both attempts still appear in the archive.
  await expect(page.locator('.coverage-trend-dot')).toHaveCount(1);
  await expect(page.locator('.progress-chart-card .session-status')).toHaveText('Interview answer aggregates only');
  await expect(page.locator('.full-session-list .session-row')).toHaveCount(2);
  await expect(page.locator('.browser-only-session')).toHaveCount(1);
});

test('one continuous interview capture stays paused for narration and resumes across questions at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const observed = window as Window & {
      __interviewMediaRequests?: number;
      __interviewMediaStreamId?: string;
      __interviewRecorderStarts?: number;
      __interviewRecorderStops?: number;
      __interviewRecognitionStarts?: number;
      __interviewRecognitionStops?: number;
      __interviewUtterance?: { lang: string; rate: number; pitch: number };
    };
    observed.__interviewMediaRequests = 0;
    observed.__interviewRecorderStarts = 0;
    observed.__interviewRecorderStops = 0;
    observed.__interviewRecognitionStarts = 0;
    observed.__interviewRecognitionStops = 0;

    class StubSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult = null;
      onerror = null;
      onend: (() => void) | null = null;
      start() {
        observed.__interviewRecognitionStarts = (observed.__interviewRecognitionStarts ?? 0) + 1;
        this.onstart?.();
      }
      stop() {
        observed.__interviewRecognitionStops = (observed.__interviewRecognitionStops ?? 0) + 1;
        this.onend?.();
      }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: StubSpeechRecognition,
    });

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
      value: {
        cancel() {},
        speak(utterance: StubUtterance) {
          observed.__interviewUtterance = {
            lang: utterance.lang,
            rate: utterance.rate,
            pitch: utterance.pitch,
          };
        },
        getVoices() { return []; },
      },
    });

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.getUserMedia) {
      const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      Object.defineProperty(mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints: MediaStreamConstraints = {}) => {
          observed.__interviewMediaRequests = (observed.__interviewMediaRequests ?? 0) + 1;
          const stream = await originalGetUserMedia(constraints);
          observed.__interviewMediaStreamId = stream.id;
          return stream;
        },
      });
    }

    if (typeof MediaRecorder !== 'undefined') {
      const originalStart = MediaRecorder.prototype.start;
      const originalStop = MediaRecorder.prototype.stop;
      Object.defineProperty(MediaRecorder.prototype, 'start', {
        configurable: true,
        value: function observedStart(this: MediaRecorder, ...args: unknown[]) {
          observed.__interviewRecorderStarts = (observed.__interviewRecorderStarts ?? 0) + 1;
          return Reflect.apply(originalStart, this, args);
        },
      });
      Object.defineProperty(MediaRecorder.prototype, 'stop', {
        configurable: true,
        value: function observedStop(this: MediaRecorder, ...args: unknown[]) {
          observed.__interviewRecorderStops = (observed.__interviewRecorderStops ?? 0) + 1;
          return Reflect.apply(originalStop, this, args);
        },
      });
    }
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
  await seedFiveCriterionRubric(page);

  await chooseInterview(page, 5);
  const question = page.locator('.kato-question-copy blockquote');
  const answerBox = page.getByLabel('Your answer');
  const beginAnswer = page.getByRole('button', { name: 'Begin this answer' });
  const captureStatus = page.locator('.studio-status');
  const replayStatus = page.locator('.recording-sync-status');
  const liveClock = page.locator('.studio-heading .studio-live');
  const captureProbe = () => page.evaluate(() => {
    const observed = window as Window & {
      __interviewMediaRequests?: number;
      __interviewMediaStreamId?: string;
      __interviewRecorderStarts?: number;
      __interviewRecorderStops?: number;
      __interviewRecognitionStarts?: number;
      __interviewRecognitionStops?: number;
    };
    return {
      mediaRequests: observed.__interviewMediaRequests ?? 0,
      mediaStreamId: observed.__interviewMediaStreamId ?? '',
      recorderStarts: observed.__interviewRecorderStarts ?? 0,
      recorderStops: observed.__interviewRecorderStops ?? 0,
      recognitionStarts: observed.__interviewRecognitionStarts ?? 0,
      recognitionStops: observed.__interviewRecognitionStops ?? 0,
    };
  });
  const clockSeconds = async () => {
    const match = (await liveClock.innerText()).match(/(\d{2}):(\d{2})/u);
    expect(match, 'the continuous capture clock must stay visible').not.toBeNull();
    return Number(match![1]) * 60 + Number(match![2]);
  };

  await expect(question).toBeVisible();
  await page.getByRole('checkbox', { name: /Live transcript English/i }).check();
  await page.getByRole('checkbox', { name: /Save replay camera \+ mic/i }).check();
  await expect(page.getByRole('button', { name: 'Start continuous interview capture' })).toBeEnabled();

  // Narration before Start never implies camera, microphone, dictation, or replay consent.
  await page.getByRole('button', { name: 'Read question aloud' }).click();
  await expect(question).toBeVisible();
  await expect(page.locator('.studio-record')).toBeDisabled();
  expect(await page.evaluate(() => (window as Window & {
    __interviewUtterance?: { lang: string; rate: number; pitch: number };
  }).__interviewUtterance)).toEqual({ lang: 'en-US', rate: 0.95, pitch: 1 });
  expect(await page.evaluate(() => (window as Window & { __interviewMediaRequests?: number }).__interviewMediaRequests)).toBe(0);

  await page.getByRole('button', { name: 'Skip narration' }).click();
  await expect(page.getByRole('button', { name: 'Start continuous interview capture' })).toBeEnabled();

  await page.getByRole('button', { name: 'Start continuous interview capture' }).click();
  await expect(captureStatus).toContainText(/paused until the first answer begins/i);
  await expect(replayStatus).toContainText(/replay recording is active/i);
  await expect(beginAnswer).toBeEnabled();
  await expect(answerBox).toBeDisabled();
  const initialProbe = await captureProbe();
  expect(initialProbe).toMatchObject({
    mediaRequests: 1,
    recorderStarts: 1,
    recorderStops: 0,
    recognitionStarts: 0,
    recognitionStops: 0,
  });
  expect(initialProbe.mediaStreamId).not.toBe('');

  await beginAnswer.click();
  await expect(captureStatus).toContainText(/Answer capture is active/i);
  await expect(answerBox).toBeEnabled();
  await answerBox.fill('Students need urgent feedback while there is still time to revise.');
  await page.waitForTimeout(1_100);
  const firstAnswerClock = await clockSeconds();
  expect((await captureProbe()).recognitionStarts).toBe(1);

  await page.getByRole('button', { name: 'Save answer & next question' }).click();
  await expect(question).toContainText(INTERVIEW_CRITERIA[1].name);
  await expect(question).toBeFocused();
  await expect(captureStatus).toContainText(/paused; camera tracking and an optional replay continue/i);
  await expect(replayStatus).toContainText(/replay recording is active/i);
  await expect(answerBox).toBeDisabled();
  const betweenQuestionsProbe = await captureProbe();
  expect(betweenQuestionsProbe).toEqual({
    mediaRequests: 1,
    mediaStreamId: initialProbe.mediaStreamId,
    recorderStarts: 1,
    recorderStops: 0,
    recognitionStarts: 1,
    recognitionStops: 1,
  });

  await page.getByRole('button', { name: 'Read question aloud' }).click();
  await expect(page.getByRole('button', { name: 'Skip narration' })).toBeVisible();
  await expect(beginAnswer).toBeDisabled();
  await expect(answerBox).toBeDisabled();
  await page.waitForTimeout(1_100);
  const narrationClock = await clockSeconds();
  expect(narrationClock).toBeGreaterThan(firstAnswerClock);
  expect(await captureProbe()).toEqual(betweenQuestionsProbe);
  await expect(replayStatus).toContainText(/replay recording is active/i);

  await page.getByRole('button', { name: 'Skip narration' }).click();
  await expect(beginAnswer).toBeEnabled();
  await beginAnswer.click();
  await expect(captureStatus).toContainText(/Answer capture is active/i);
  await expect(answerBox).toBeEnabled();
  await answerBox.fill('The rubric isolates one weak claim and guides a focused retry.');
  await page.waitForTimeout(1_100);
  expect(await clockSeconds()).toBeGreaterThanOrEqual(narrationClock);
  expect((await captureProbe()).recognitionStarts).toBe(2);

  await page.getByRole('button', { name: 'Save answer & next question' }).click();
  await expect(question).toContainText(INTERVIEW_CRITERIA[2].name);
  await expect(question).toBeFocused();
  expect(await captureProbe()).toEqual({
    mediaRequests: 1,
    mediaStreamId: initialProbe.mediaStreamId,
    recorderStarts: 1,
    recorderStops: 0,
    recognitionStarts: 2,
    recognitionStops: 2,
  });
  await expect(replayStatus).toContainText(/replay recording is active/i);
  await expectNoHorizontalOverflow(page);
});
