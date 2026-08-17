import { expect, test } from '@playwright/test';

// The progress page is where a returning user decides whether practising is
// working. Its charts have to be readable as SHAPES, not as numbers with
// decoration around them — so these assertions check the geometry that gets
// drawn, not only the text beside it.

const SESSIONS_KEY = 'talkactive.production.sessions.v1';

function attempt(
  id: string,
  createdAt: string,
  evidenceScore: number,
  feasibility: number,
  span: string,
) {
  return {
    id,
    createdAt,
    evidenceScore,
    weakest: 'Feasibility',
    defenseStatus: 'developing',
    projectId: null,
    criteria: [
      {
        criterionId: 'criterion-feasibility',
        criterionName: 'Feasibility',
        verdict: feasibility === 1 ? 'supported' : feasibility === 0 ? 'unsupported' : 'partial',
        coverage: feasibility,
        citedSpan: feasibility === 0 ? null : span,
        missingEvidence: feasibility === 1 ? [] : ['timeline', 'cost'],
      },
      {
        criterionId: 'criterion-problem',
        criterionName: 'Problem clarity',
        verdict: 'supported',
        coverage: 1,
        citedSpan: 'Students rehearse without evaluator-specific feedback.',
        missingEvidence: [],
      },
    ],
  };
}

const CLIMBING = [
  attempt('a-1', '2026-08-09T08:00:00.000Z', 40, 0.2, 'We can build it in four days.'),
  attempt('a-2', '2026-08-10T08:00:00.000Z', 55, 0.4, 'We can build it in four days on one laptop.'),
  attempt('a-3', '2026-08-11T08:00:00.000Z', 70, 0.6, 'We built it in four days on one laptop.'),
  attempt('a-4', '2026-08-12T08:00:00.000Z', 85, 0.9, 'We built it in four days and the gate runs in 90 seconds.'),
];

async function seed(page: import('@playwright/test').Page, rows: unknown) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)),
    [SESSIONS_KEY, rows] as const);
  await page.goto('/progress');
}

test('the coverage trend draws one point per saved attempt, in order', async ({ page }) => {
  await seed(page, CLIMBING);

  const trend = page.locator('.coverage-trend');
  await expect(trend).toBeVisible();
  await expect(trend.locator('.coverage-trend-dot')).toHaveCount(CLIMBING.length);

  // Rising coverage must draw a rising line, and rising on screen means a
  // SMALLER y. Measured from the rendered box rather than an attribute, so a
  // CSS positioning bug fails here too — the points are placed by percentage
  // over the plot, which is exactly the kind of thing that silently drifts.
  const plot = await trend.locator('.coverage-trend-plotwrap').boundingBox();
  expect(plot, 'the plot must have rendered bounds').not.toBeNull();
  const boxes = await trend.locator('.coverage-trend-dot').evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    }));
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index].y, `attempt ${index + 1} did not plot above attempt ${index}`)
      .toBeLessThan(boxes[index - 1].y);
    expect(boxes[index].x, `attempt ${index + 1} did not plot to the right of attempt ${index}`)
      .toBeGreaterThan(boxes[index - 1].x);
  }
  // The first and last points sit on the plot's own edges. If the scale column
  // ever shifts the dots out of the box the line is drawn in, this catches it.
  expect(Math.abs(boxes[0].x - (plot?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs(boxes[boxes.length - 1].x - ((plot?.x ?? 0) + (plot?.width ?? 0)))).toBeLessThan(2);

  await expect(trend.locator('.coverage-trend-latest')).toContainText('85%');
});

test('a single attempt plots a point but never implies a trend', async ({ page }) => {
  await seed(page, [CLIMBING[0]]);

  const trend = page.locator('.coverage-trend');
  await expect(trend.locator('.coverage-trend-dot')).toHaveCount(1);
  // One point is not a trend, so no filled area is drawn under it.
  await expect(trend.locator('.coverage-trend-area')).toHaveCount(0);
  await expect(trend.locator('.coverage-trend-axis')).toContainText('percobaan pertama');
});

test('a recurring gap shows its direction, not just its count', async ({ page }) => {
  await seed(page, CLIMBING);

  const recurring = page.locator('.recurring-item').first();
  await expect(recurring).toContainText('Feasibility');

  const spark = recurring.locator('.criterion-spark');
  await expect(spark).toBeVisible();
  await expect(spark).toHaveAttribute('data-direction', 'rising');
  // The direction is stated in words as well as drawn. Colour alone would fail
  // a colourblind reader, and this product deliberately has no green/red axis.
  await expect(spark.locator('.criterion-spark-read')).toContainText('20% → 90%');
  await expect(spark.locator('.criterion-spark-read')).toContainText('+70 poin');
  await expect(spark.locator('.criterion-spark-line')).toHaveCount(1);
});

test('a criterion that never moved draws a flat line and says so', async ({ page }) => {
  await seed(page, CLIMBING.map((row) => ({
    ...row,
    weakest: 'Problem clarity',
    criteria: row.criteria.map((criterion) => ({ ...criterion, coverage: 0.5, verdict: 'partial', citedSpan: 'A steady claim.', missingEvidence: ['proof'] })),
  })));

  const spark = page.locator('.recurring-item').first().locator('.criterion-spark');
  await expect(spark).toHaveAttribute('data-direction', 'flat');
  await expect(spark.locator('.criterion-spark-read')).toContainText('tidak berubah sepanjang percobaan ini');
});

test('the latest diff shows what moved and only names what held', async ({ page }) => {
  await seed(page, CLIMBING);

  const diff = page.locator('.attempt-diff-card');
  // Feasibility moved between a-3 and a-4; Problem clarity held at full
  // coverage. Rendering both sides of an identical quote for the criterion that
  // did not change is what made this card the longest thing on the page.
  await expect(diff.locator('.attempt-diff-item')).toHaveCount(1);
  await expect(diff.locator('.attempt-diff-item')).toContainText('Feasibility');
  await expect(diff.locator('.attempt-diff-held')).toContainText('Problem clarity');
  await expect(diff.locator('.attempt-diff-item')).not.toContainText('Problem clarity');
});

test('the progress page never draws a chart it has no history for', async ({ page }) => {
  await page.goto('/progress');

  await expect(page.locator('.chart-empty')).toBeVisible();
  await expect(page.locator('.coverage-trend-dot')).toHaveCount(0);
  await expect(page.locator('.criterion-spark')).toHaveCount(0);
});
