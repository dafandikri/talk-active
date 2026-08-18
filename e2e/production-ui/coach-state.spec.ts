import { expect, test } from '@playwright/test';

// The dashboard's only illustration is supposed to report the state of the
// work. That claim is worth checking in a real browser: a pose chosen in a
// component is easy to get right and just as easy to leave hardcoded.

const SESSIONS_KEY = 'talkactive.production.sessions.v1';

function savedSession(evidenceScore: number, weakest: string) {
  return [{
    id: '019ff7f4-e54b-7aaa-baba-1234567890ab',
    createdAt: '2026-08-13T02:00:00.000Z',
    evidenceScore,
    weakest,
    defenseStatus: 'developing',
    projectId: null,
    criteria: [],
  }];
}

test('with nothing saved, the coach is waiting and the art has loaded', async ({ page }) => {
  await page.goto('/workspace');
  const mascot = page.locator('.focus-mascot');
  await expect(mascot).toHaveAttribute('data-coach', 'waiting');
  await expect(mascot).toHaveJSProperty('complete', true);
  await expect(page.locator('.coach-bubble')).toContainText('Siap untuk pertanyaan sulitnya?');
});

test('an open gap names the criterion it is open on', async ({ page }) => {
  await page.addInitScript(([key, rows]) => localStorage.setItem(key as string, JSON.stringify(rows)),
    [SESSIONS_KEY, savedSession(62, 'Differentiation')] as const);
  await page.goto('/workspace');

  const mascot = page.locator('.focus-mascot');
  await expect(mascot).toHaveAttribute('data-coach', 'gap');
  await expect(mascot).toHaveJSProperty('complete', true);
  // Naming the criterion is the point. "You have a gap" would be a mood.
  await expect(page.locator('.coach-bubble')).toContainText('Differentiation');
});

test('complete coverage switches the pose rather than repeating the gap', async ({ page }) => {
  await page.addInitScript(([key, rows]) => localStorage.setItem(key as string, JSON.stringify(rows)),
    [SESSIONS_KEY, savedSession(100, 'Differentiation')] as const);
  await page.goto('/workspace');

  const mascot = page.locator('.focus-mascot');
  await expect(mascot).toHaveAttribute('data-coach', 'supported');
  await expect(mascot).toHaveJSProperty('complete', true);
  await expect(page.locator('.coach-bubble')).not.toContainText('gap is still open');
});

test('each state draws a different pose, so the state is visible not just labelled', async ({ page }) => {
  const sourceFor = async (rows: unknown | null) => {
    if (rows) {
      await page.addInitScript(([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)),
        [SESSIONS_KEY, rows] as const);
    }
    await page.goto('/workspace');
    return page.locator('.focus-mascot').getAttribute('src');
  };

  const waiting = await sourceFor(null);
  await page.context().clearCookies();
  const gap = await sourceFor(savedSession(62, 'Differentiation'));

  expect(waiting).not.toEqual(gap);
  expect(waiting).toBeTruthy();
});

// The insight band answers "what do I rehearse next" from attempts already
// saved here. Both readings are deliberately conservative: a gap is only
// "recurring" after more than one attempt, and a run of two is not called a
// trend. These pin that restraint, because loosening it is how a dashboard
// starts asserting things the data cannot carry.

function attempt(id: string, at: string, score: number, coverage: number) {
  return {
    id, createdAt: at, evidenceScore: score, weakest: 'Differentiation',
    defenseStatus: 'developing', projectId: null,
    criteria: [
      {
        criterionId: '019ff7f4-e54b-7aaa-baba-00000000000a',
        criterionName: 'Differentiation',
        verdict: coverage < 1 ? 'unsupported' : 'supported',
        coverage,
        citedSpan: coverage < 1 ? null : 'We are unlike existing tools.',
        missingEvidence: coverage < 1 ? ['existing tools', 'competitor'] : [],
      },
    ],
  };
}

async function seed(page: import('@playwright/test').Page, rows: unknown[]) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)),
    [SESSIONS_KEY, rows] as const);
}

test('the band names the recurring gap and the direction of the run', async ({ page }) => {
  await seed(page, [
    attempt('019ff7f4-e54b-7aaa-baba-000000000001', '2026-08-11T02:00:00.000Z', 40, 0.2),
    attempt('019ff7f4-e54b-7aaa-baba-000000000002', '2026-08-12T02:00:00.000Z', 62, 0.5),
    attempt('019ff7f4-e54b-7aaa-baba-000000000003', '2026-08-13T02:00:00.000Z', 88, 0.75),
  ]);
  await page.goto('/workspace');

  const band = page.locator('.insight-band');
  await expect(band).toBeVisible();
  await expect(band.getByText('Differentiation', { exact: true })).toBeVisible();
  await expect(band.getByText('Unsupported in 3 of 3 saved attempts.')).toBeVisible();
  await expect(band.getByText(/Naik 48 poin|Up 48 points/)).toBeVisible();
  // The figure never gets to stand alone.
  await expect(band.getByText(/bukan nilai untuk Anda/i)).toBeVisible();
  // The chart is readable without seeing it.
  await expect(band.locator('.insight-spark')).toHaveAttribute('aria-label', /40%, 62%, 88%/);
});

test('two attempts is a pair, and the band says so instead of drawing a trend', async ({ page }) => {
  await seed(page, [
    attempt('019ff7f4-e54b-7aaa-baba-000000000001', '2026-08-12T02:00:00.000Z', 40, 0.2),
    attempt('019ff7f4-e54b-7aaa-baba-000000000002', '2026-08-13T02:00:00.000Z', 88, 0.75),
  ]);
  await page.goto('/workspace');

  await expect(page.locator('.insight-band')).toBeVisible();
  await expect(page.getByText(/belum sebuah tren/i)).toBeVisible();
});

test('one attempt shows no band at all, because there is nothing to compare', async ({ page }) => {
  await seed(page, [attempt('019ff7f4-e54b-7aaa-baba-000000000001', '2026-08-13T02:00:00.000Z', 88, 0.75)]);
  await page.goto('/workspace');

  await expect(page.locator('.focus-card')).toBeVisible();
  await expect(page.locator('.insight-band')).toHaveCount(0);
});

// The pose must not change the height of the card. Each drawing has a different
// aspect ratio (1.25, 0.98, 1.38), and the container has a min-height but no
// definite height, so an in-flow image falls back to its own ratio and the tall
// pose pushes the practice action below the fold. That reproduced only on CI,
// where the column geometry let the image win the row.
//
// An earlier version of this check compared the width and height attributes,
// which are not layout. This one measures what actually rendered.
for (const [label, rows] of [
  ['nothing saved', null],
  ['an open gap', savedSession(62, 'Differentiation')],
  ['full coverage', savedSession(100, 'Differentiation')],
] as const) {
  test(`the practice action stays above the fold at 720p with ${label}`, async ({ page }) => {
    if (rows) {
      await page.addInitScript(([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)),
        [SESSIONS_KEY, rows] as const);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/workspace');

    const action = page.locator('.view a[href="/practice"]').first();
    await expect(action).toBeVisible();
    const bounds = await action.boundingBox();
    expect(bounds, 'the practice action must have rendered bounds').not.toBeNull();
    expect((bounds?.y ?? 720) + (bounds?.height ?? 0)).toBeLessThanOrEqual(720);

    // The image is out of flow, so whichever pose the state picked cannot be
    // what decides the row height.
    const drivesLayout = await page.locator('.focus-mascot').evaluate(
      (element) => getComputedStyle(element).position !== 'absolute',
    );
    expect(drivesLayout, 'an in-flow mascot lets the pose resize the card').toBe(false);
  });
}
