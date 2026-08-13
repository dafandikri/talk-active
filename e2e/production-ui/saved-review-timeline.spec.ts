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
        }],
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test('the saved review plots every cue in time, in its own lane', async ({ page }) => {
  await mockAttempt(page, { recordingStatus: 'ready' });
  await page.goto(`/attempts/${ATTEMPT_ID}`);
  await expect(page.getByRole('link', { name: 'Back to progress' })).toHaveCount(0);

  const timeline = page.locator('.saved-attempt-timeline');
  await expect(timeline).toBeVisible();

  // Two lanes, because voice and camera cues are different observations.
  await expect(timeline.locator('.timeline-lane')).toHaveCount(2);
  await expect(timeline.getByText('Voice', { exact: true })).toBeVisible();
  await expect(timeline.getByText('Camera', { exact: true })).toBeVisible();

  // Every event reaches the plot, none silently dropped.
  await expect(timeline.locator('.timeline-mark')).toHaveCount(4);

  // Position is the information. Read per lane, because marks are grouped by
  // lane and not by clock: the last mark in the document is the camera cue at
  // 95s, not the voice cue at 112s.
  const leftsIn = (lane: number) => timeline.locator('.timeline-lane').nth(lane)
    .locator('.timeline-mark')
    .evaluateAll((nodes) => nodes.map((node) => Number.parseFloat((node as HTMLElement).style.left)));

  const voice = await leftsIn(0);
  expect(voice).toHaveLength(3);
  expect(voice[0]).toBeLessThan(10);                    // 8s of 120s
  expect(voice[voice.length - 1]).toBeGreaterThan(90);  // 112s of 120s
  expect([...voice]).toEqual([...voice].sort((a, b) => a - b));

  const camera = await leftsIn(1);
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

test('the plotted cues and the written list describe the same events', async ({ page }) => {
  await mockAttempt(page, { recordingStatus: 'ready' });
  await page.goto(`/attempts/${ATTEMPT_ID}`);

  // The list is the chart's text equivalent, so the two must not disagree.
  await expect(page.locator('.saved-attempt-timeline .timeline-mark')).toHaveCount(4);
  await expect(page.locator('.saved-timeline-list li')).toHaveCount(4);
});
