import { expect, test, type Page } from '@playwright/test';

// The live studio cannot produce this view in a headless run: the synthetic
// camera has no face in it, so MediaPipe detects nothing and no cue is ever
// recorded. The saved review reads the same events back from the API, which
// means the timeline can actually be exercised here rather than assumed.

const ATTEMPT_ID = '019ff7f4-e54b-7aaa-baba-1234567890ab';
const CREATED_AT = '2026-08-13T02:00:00.000Z';

function deliveryEvent(id: string, source: string, startMs: number, endMs: number, label: string) {
  return { id, attemptId: ATTEMPT_ID, source, kind: 'interim-filler', startMs, endMs, label, evidence: 'Prototype threshold flagged this span.', createdAt: CREATED_AT };
}

async function mockAttempt(page: Page, options: { recordingStatus: 'ready' | null }) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/capabilities') {
      return json({ contractVersion: 2, persistence: 'neon', accounts: true, sourceDocuments: true, recordings: true, semantic: { rubric: false, evidence: false, question: false, defense: false } });
    }
    if (url.pathname === `/api/attempts/${ATTEMPT_ID}/review`) {
      return json({
        contractVersion: 2,
        project: {
          id: '019ff7f4-e54b-7aaa-baba-00000000000c', userId: '019ff7f4-e54b-7aaa-baba-00000000000a',
          title: 'RISTEK Finals Pitch', language: 'id-ID', eventContext: 'Innovation Week final',
          deadline: '2026-08-13', createdAt: CREATED_AT, updatedAt: CREATED_AT,
        },
        attempt: {
          id: ATTEMPT_ID, projectId: '019ff7f4-e54b-7aaa-baba-00000000000c', mode: 'dictated', status: 'review',
          transcript: 'We map every claim back to a criterion in the evaluator rubric.',
          transcriptSource: 'web-speech', durationSeconds: 120, createdAt: CREATED_AT, completedAt: null,
        },
        deliveryReview: {
          attemptId: ATTEMPT_ID, mode: 'presentation', vocalScore: 78, visualScore: 64,
          trackingCoveragePercent: 91, fillerCount: 3, repeatedWordCount: 1,
          boundary: 'Observable cues only; not a measure of the speaker.', createdAt: CREATED_AT,
        },
        deliveryEvents: [
          deliveryEvent('019ff7f4-e54b-7aaa-baba-000000000001', 'acoustic', 8_000, 8_900, 'possible hesitation'),
          deliveryEvent('019ff7f4-e54b-7aaa-baba-000000000002', 'interim-transcript', 61_000, 61_400, 'um'),
          deliveryEvent('019ff7f4-e54b-7aaa-baba-000000000003', 'vision', 95_000, 99_000, 'body out of frame'),
          deliveryEvent('019ff7f4-e54b-7aaa-baba-000000000004', 'acoustic', 112_000, 113_500, 'repeated start'),
        ],
        recording: options.recordingStatus === null ? null : {
          id: '019ff7f4-e54b-7aaa-baba-00000000000d', attemptId: ATTEMPT_ID, status: 'ready',
          contentType: 'video/webm', sizeBytes: 1_200_000, durationMs: 120_000,
          expiresAt: '2026-09-12T02:00:00.000Z', createdAt: CREATED_AT, uploadedAt: CREATED_AT,
        },
        evidence: [{
          criterionId: '019ff7f4-e54b-7aaa-baba-00000000000e', criterionName: 'Rubric grounding',
          verdict: 'supported', coverageScore: 1,
          citedSpan: 'We map every claim back to a criterion in the evaluator rubric.',
          missingEvidence: [], engine: 'deterministic',
        }, {
          criterionId: '019ff7f4-e54b-7aaa-baba-00000000000f', criterionName: 'Measured impact',
          verdict: 'unsupported', coverageScore: 0,
          citedSpan: null, missingEvidence: ['measured outcome', 'cost'], engine: 'deterministic',
        }],
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test('the saved review leads with traceable evidence and a predictable way back', async ({ page }) => {
  await mockAttempt(page, { recordingStatus: 'ready' });
  await page.goto(`/attempts/${ATTEMPT_ID}`);

  await expect(page.getByRole('link', { name: 'Back to progress' }))
    .toHaveAttribute('href', '/progress?project=019ff7f4-e54b-7aaa-baba-00000000000c');
  await expect(page.locator('.main-nav a[href="/progress"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('RISTEK Finals Pitch · Bahasa Indonesia', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 of 2 criteria cite your exact words' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Measured impact' }).first()).toBeVisible();
  await expect(page.getByText('measured outcome', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('We map every claim back to a criterion in the evaluator rubric.', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/not confidence, intelligence, or speaking ability/i)).toBeVisible();

  const order = await page.locator('.saved-review').evaluate((root) => {
    const children = [...root.querySelectorAll<HTMLElement>('.saved-rubric-card, .saved-timeline-card, .saved-replay-card, .saved-delivery-section')];
    return children.map((child) => child.className);
  });
  expect(order[0]).toContain('saved-rubric-card');
  expect(order[1]).toContain('saved-timeline-card');
  expect(order[2]).toContain('saved-replay-card');
  expect(order[3]).toContain('saved-delivery-section');

  await page.reload();
  await expect(page.getByText('RISTEK Finals Pitch · Bahasa Indonesia', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 of 2 criteria cite your exact words' })).toBeVisible();
  await expect(page.getByText('We map every claim back to a criterion in the evaluator rubric.', { exact: false }).first()).toBeVisible();
});

test('the saved review plots every cue in its labelled lane on one accessible clock', async ({ page }) => {
  await mockAttempt(page, { recordingStatus: 'ready' });
  await page.goto(`/attempts/${ATTEMPT_ID}`);

  const timeline = page.locator('.saved-attempt-timeline');
  await expect(timeline).toBeVisible();
  await expect(timeline).toHaveAttribute('aria-label', /timeline lasting 2:00 with rubric, voice, and camera lanes/i);

  // One shared clock: rubric context plus independently labelled voice and camera lanes.
  await expect(timeline.locator('.timeline-lane')).toHaveCount(3);
  await expect(timeline.getByText('Rubric', { exact: true })).toBeVisible();
  await expect(timeline.getByText('Voice', { exact: true })).toBeVisible();
  await expect(timeline.getByText('Camera', { exact: true })).toBeVisible();

  // Every event reaches the plot, none silently dropped.
  await expect(timeline.locator('.timeline-mark')).toHaveCount(4);
  const hitTarget = await timeline.locator('.timeline-mark').first().evaluate((mark) => {
    const pseudo = getComputedStyle(mark, '::after');
    return { width: pseudo.width, height: pseudo.height };
  });
  expect(hitTarget).toEqual({ width: '44px', height: '44px' });

  // Position is the information. Read per lane, because marks are grouped by
  // lane and not by clock: the last mark in the document is the camera cue at
  // 95s, not the voice cue at 112s.
  const leftsIn = (lane: number) => timeline.locator('.timeline-lane').nth(lane)
    .locator('.timeline-mark')
    .evaluateAll((nodes) => nodes.map((node) => Number.parseFloat((node as HTMLElement).style.left)));

  const voice = await leftsIn(1);
  expect(voice).toHaveLength(3);
  expect(voice[0]).toBeLessThan(10);                    // 8s of 120s
  expect(voice[voice.length - 1]).toBeGreaterThan(90);  // 112s of 120s
  expect([...voice]).toEqual([...voice].sort((a, b) => a - b));

  const camera = await leftsIn(2);
  expect(camera).toHaveLength(1);
  expect(camera[0]).toBeGreaterThan(75);                // 95s of 120s
  expect(camera[0]).toBeLessThan(85);

  // Readable without seeing it.
  await expect(timeline.locator('.timeline-mark').first())
    .toHaveAttribute('aria-label', /0:08, possible hesitation/);
});

test('without a replay the cues still plot, but cannot be played', async ({ page }) => {
  await mockAttempt(page, { recordingStatus: null });
  await page.goto(`/attempts/${ATTEMPT_ID}`);

  const marks = page.locator('.saved-attempt-timeline .timeline-mark');
  await expect(marks).toHaveCount(4);
  await expect(marks.first()).toBeDisabled();
  await expect(marks.first()).toHaveAttribute('aria-label', /cannot be played/);
});

test('raw events are disclosed on demand and remain the chart text equivalent', async ({ page }) => {
  await mockAttempt(page, { recordingStatus: 'ready' });
  await page.goto(`/attempts/${ATTEMPT_ID}`);

  const disclosure = page.getByText('Read every timeline observation', { exact: true });
  await expect(page.locator('.saved-timeline-list')).not.toBeVisible();
  await disclosure.click();
  await expect(page.locator('.saved-timeline-list')).toBeVisible();

  // The on-demand list is the chart's text equivalent, so the two must not disagree.
  await expect(page.locator('.saved-attempt-timeline .timeline-mark')).toHaveCount(4);
  await expect(page.locator('.saved-timeline-list li')).toHaveCount(4);
});

test('replay and delivery detail stay collapsed until requested', async ({ page }) => {
  await mockAttempt(page, { recordingStatus: 'ready' });
  await page.goto(`/attempts/${ATTEMPT_ID}`);

  await expect(page.locator('.saved-replay-video')).not.toBeVisible();
  await expect(page.locator('.saved-delivery-metrics')).not.toBeVisible();
  await page.locator('.saved-replay-card > summary').click();
  await expect(page.locator('.saved-replay-video')).toBeVisible();
  await page.locator('.saved-delivery-summary > summary').click();
  await expect(page.locator('.saved-delivery-metrics')).toBeVisible();
});
