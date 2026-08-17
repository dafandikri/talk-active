import { expect, test } from '@playwright/test';

async function expectVisibleControlsHitTest(page: import('@playwright/test').Page) {
  const controls = page.locator('a[href], button:not([disabled]), input:not([type="hidden"]), textarea, select, summary');
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    const skipLinkState = await control.evaluate((element) => ({
      focused: element === document.activeElement,
      skipLink: element.classList.contains('skip-link'),
    }));
    if (skipLinkState.skipLink && !skipLinkState.focused) continue;
    if (!await control.isVisible()) continue;
    await control.click({ trial: true });
    if (skipLinkState.skipLink) await control.blur();
  }
}

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== 'http://127.0.0.1:4183') {
      externalRequests.push(request.url());
    }
  });
  (page as typeof page & { consoleErrors?: string[] }).consoleErrors = consoleErrors;
  (page as typeof page & { externalRequests?: string[] }).externalRequests = externalRequests;
});

test.afterEach(async ({ page }) => {
  expect((page as typeof page & { consoleErrors?: string[] }).consoleErrors ?? []).toEqual([]);
  expect((page as typeof page & { externalRequests?: string[] }).externalRequests ?? []).toEqual([]);
});

test('cold-start guest completes landing → attempt → evidence → defense → saved reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Latih klaim yang akan ditantang juri berikutnya.' })).toBeVisible();
  await page.getByRole('link', { name: /^Mulai berlatih\b/i }).first().click();
  await expect(page).toHaveURL(/\/enter$/u);
  await page.getByRole('button', { name: 'Lanjut tanpa nama' }).click();
  await expect(page).toHaveURL(/\/workspace$/u);
  await expect(page.getByRole('heading', { name: 'Make your next answer harder to challenge.' })).toBeVisible();
  await expect(page.locator('.focus-mascot')).toHaveJSProperty('complete', true);
  await expectVisibleControlsHitTest(page);

  await page.getByRole('link', { name: /Continue practising/i }).click();
  await expect(page).toHaveURL(/\/practice$/u);
  await expect(page.getByRole('link', { name: 'Exit session' })).toHaveCount(0);
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await expect(page.getByLabel('Practice transcript')).toBeVisible();
  await expectVisibleControlsHitTest(page);
  const reviewedDraft = await page.getByLabel('Practice transcript').inputValue();
  await page.getByRole('button', { name: /Review this attempt/i }).click();

  await expect(page.getByRole('heading', { name: 'What your transcript actually supports' })).toBeVisible();
  await expect(page.locator('.evidence-item')).toHaveCount(4);
  await expect(page.locator('.evidence-provenance')).toHaveCount(4);
  await expect(page.locator('.production-confirm')).toHaveCount(4);
  await expect(page.getByText(/not confidence or speaking ability/i)).toBeVisible();
  await expect(page.getByText(/Equal mean of 4 criterion readings/i)).toBeVisible();
  await expect(page.getByText(/Each criterion has the same weight/i)).toBeVisible();
  await expectVisibleControlsHitTest(page);

  // Practice is one URL but several real screens. Browser Back/Forward must
  // traverse those screens without discarding the draft or the completed
  // review, just like the visible Back controls do.
  await page.goBack();
  await expect(page.locator('.capture-header h2')).toBeFocused();
  await expect(page.getByLabel('Practice transcript')).toHaveValue(reviewedDraft);
  await page.goForward();
  await expect(page.getByRole('heading', { name: /One claim needs your attention/i })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'What your transcript actually supports' })).toBeVisible();

  // Matched by pattern, not by exact string. The visible button says only
  // "Yes"/"No", so the accessible name has to name the criterion AND what
  // agreeing to it means — wording that should stay free to improve. What must
  // not change is that the name identifies its criterion unambiguously.
  await page.getByRole('button', { name: /^Confirm\b.*\bProblem clarity$/ }).click();
  await expect(page.getByText(/Saved in this browser as a human evaluation label; the original deterministic provenance is preserved\./u)).toBeVisible();
  await page.getByRole('button', { name: /^Reject\b.*\bSolution fit$/ }).click();
  await expect(page.getByText(/re-checked once with the rejected sentence excluded/i)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('talkactive.production.evidence-confirmations.v1');
    return raw ? JSON.parse(raw).length : 0;
  })).toBe(2);

  await page.getByRole('button', { name: /Practise my answer/i }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: /One claim needs your attention/i })).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Defend the weakest claim' })).toBeFocused();
  await page.getByLabel('Your answer').fill(
    'Compared with competitors, our unique logic keeps every verdict traceable to the evaluator rubric.',
  );
  await page.getByRole('button', { name: /Check this answer/i }).click();
  await expect(page.getByRole('heading', { name: 'defensible' })).toBeVisible();
  await expectVisibleControlsHitTest(page);
  await page.getByRole('button', { name: /Save this session/i }).click();

  await expect(page).toHaveURL(/\/progress$/u);
  await expect(page.getByRole('link', { name: 'New practice' })).toHaveCount(0);
  // The trend was a row of columns labelled "Attempt 1", "Attempt 2" with their
  // heights set in raw pixels. It is now a line on a labelled 0–100 axis, so the
  // saved attempt shows up as a plotted point rather than a caption — which is
  // why the "Attempt 1" assertion that stood here is gone rather than kept.
  await expect(page.locator('.coverage-trend-dot')).toHaveCount(1);
  await expect(page.locator('.coverage-trend-latest')).toBeVisible();
  await expect(page.locator('.full-session-list .session-status').getByText('defensible', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The criteria that keep returning' })).toBeVisible();
  await expect(page.getByText(/before Talk-Active calls any gap recurring/i)).toBeVisible();
  await expectVisibleControlsHitTest(page);

  // INV-8 is a persistence path, not merely a navigation path. A reload must
  // reconstruct the saved evidence summary from browser storage without a
  // blank card, console error, or invented placeholder value.
  await page.reload();
  await expect(page.locator('.coverage-trend-dot')).toHaveCount(1);
  await expect(page.locator('.full-session-list .session-status').getByText('defensible', { exact: true })).toBeVisible();
  await expect(page.getByText(/before Talk-Active calls any gap recurring/i)).toBeVisible();
});

test('workspace keeps one practice action above the fold at 720p', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/workspace');
  const practiceActions = page.locator('.view a[href="/practice"]');
  await expect(practiceActions).toHaveCount(1);
  await expect(practiceActions).toHaveAccessibleName('Continue practising');
  const actionBounds = await practiceActions.boundingBox();
  expect(actionBounds, 'the dominant practice action must have rendered bounds').not.toBeNull();
  expect((actionBounds?.y ?? 720) + (actionBounds?.height ?? 0)).toBeLessThanOrEqual(720);

  const skipLink = page.getByRole('link', { name: 'Skip to workspace content' });
  await expect(skipLink).not.toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  await expectVisibleControlsHitTest(page);
});

test('production metadata and unknown routes remain branded and same-origin', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/talk-active-id\.vercel\.app\/?$/u);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Talk-Active/u);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/talk-active-id\.vercel\.app\//u);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');

  const robots = await request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toMatch(/User-Agent: \*/iu);

  const notFound = await request.get('/route-that-does-not-exist');
  expect(notFound.status()).toBe(404);
  const notFoundHtml = await notFound.text();
  expect(notFoundHtml).toContain('This route is not part of the rehearsal workspace.');
  expect(notFoundHtml).toContain('Return to Talk-Active');
  await expectVisibleControlsHitTest(page);
});

test('review visibly flags one citation reused across criteria', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem(
    'talkactive.production.rubric.v1',
    JSON.stringify([
      { id: 'grounding', name: 'Grounding', evidence: 'rubric', sourceExcerpt: null },
      { id: 'evaluation-fit', name: 'Evaluation fit', evidence: 'rubric', sourceExcerpt: null },
    ]),
  ));
  await page.goto('/practice');
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await page.getByLabel('Practice transcript').fill(
    'Our rubric maps each claim to evidence before the evaluator asks a question.',
  );
  await page.getByRole('button', { name: /Review this attempt/i }).click();

  const reused = page.locator('.evidence-item[data-evidence="reused"]');
  await expect(reused).toHaveCount(2);
  // Scoped to the criterion cards. The evidence map above them announces the
  // same state to screen readers for each cell, which is correct for an index
  // but makes a page-wide text count ambiguous about where the verdict lives.
  await expect(page.locator('.evidence-item .evidence-state')
    .filter({ hasText: /^citation reused$/ })).toHaveCount(2);
  await expect(page.locator('.evidence-map a[data-evidence="reused"]')).toHaveCount(2);
  await expect(reused.first().locator('.citation-reuse-note')).toContainText('Evaluation fit');
  await expect(reused.last().locator('.citation-reuse-note')).toContainText('Grounding');
  await expect(page.locator('.evidence-item[data-evidence="found"]')).toHaveCount(0);
  await expectVisibleControlsHitTest(page);
});

test('local guest workspace uses stateless semantic review when the capability is available', async ({ page }) => {
  const transcript = 'Many Indonesian students prepare important presentations alone and only receive feedback after the result is final. Talk-Active lets a student use the actual evaluation rubric while practicing a pitch. It maps each claim in the transcript to a criterion, points out what is still unsupported, and asks a judge-style follow-up question about the weakest claim. The student then retries one focused section and sees whether the evidence improved. The current implementation uses local transcript analysis, so no recording is stored.';
  const rows = [
    {
      id: 'problem-clarity', label: 'Problem clarity',
      requirementText: 'problem, students, evidence, urgency',
      signals: ['problem', 'students', 'evidence', 'urgency'],
      excerpt: 'Many Indonesian students prepare important presentations alone and only receive feedback after the result is final.',
      missingSignals: ['urgency'],
    },
    {
      id: 'solution-fit', label: 'Solution fit',
      requirementText: 'rubric, feedback, retry, improvement',
      signals: ['rubric', 'feedback', 'retry', 'improvement'],
      excerpt: 'Talk-Active lets a student use the actual evaluation rubric while practicing a pitch.',
      missingSignals: ['measured improvement'],
    },
    {
      id: 'differentiation', label: 'Differentiation',
      requirementText: 'competitors, unique logic, traceable',
      signals: ['competitors', 'unique', 'logic', 'traceable'],
      excerpt: 'It maps each claim in the transcript to a criterion, points out what is still unsupported, and asks a judge-style follow-up question about the weakest claim.',
      missingSignals: ['competitor comparison'],
    },
    {
      id: 'feasibility-and-trust', label: 'Feasibility and trust',
      requirementText: 'prototype, architecture, privacy, limitations',
      signals: ['prototype', 'architecture', 'privacy', 'limitations'],
      excerpt: 'The current implementation uses local transcript analysis, so no recording is stored.',
      missingSignals: ['architecture'],
    },
  ].map((row) => ({
    ...row,
    score: 50,
    status: 'partial',
    matchedSignals: [],
  }));
  let analyzeCalls = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const respond = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (pathname === '/api/capabilities') return respond({
      contractVersion: 2,
      persistence: 'local',
      accounts: false,
      sourceDocuments: false,
      recordings: false,
      semantic: { rubric: false, evidence: true, question: true, defense: false },
    });
    if (pathname === '/api/analyze' && request.method() === 'POST') {
      analyzeCalls += 1;
      const input = request.postDataJSON();
      expect(input.transcript).toBe(transcript);
      expect(input.rubricText).toBeUndefined();
      expect(input.criteria).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'problem-clarity',
          name: 'Problem clarity',
          description: expect.any(String),
          requiredEvidence: expect.any(Array),
          displayOrder: 0,
        }),
      ]));
      return respond({
        contractVersion: 2,
        analysis: {
          evidenceScore: 50,
          coveredCount: 0,
          criterionCount: 4,
          criteria: rows,
          weakest: rows[0],
          judgeQuestion: 'What direct evidence proves this student problem is urgent now?',
          drill: 'Retry only “Problem clarity” in 30 seconds. Use claim → evidence → why it matters.',
          delivery: {
            wordCount: 76, durationSeconds: 90, wordsPerMinute: 51, pace: 'deliberate',
            fillerCount: 0, fillers: [],
          },
        },
        mode: 'semantic',
        criterionEngines: rows.map((row) => ({ criterionId: row.id, engine: 'semantic' })),
        reusedCitations: [],
        questionEngine: 'semantic',
        cached: false,
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/practice');
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await expect(page.getByText(/Semantic review sends this transcript and the typed rubric criteria/u)).toBeVisible();
  await page.getByRole('button', { name: /Review this attempt/i }).click();
  await expect(page.getByText(/4 of 4 criteria used semantic mapping/u)).toBeVisible();
  await expect(page.getByText(/judge question used semantic generation/u)).toBeVisible();
  await expect(page.locator('.evidence-provenance')).toHaveCount(4);
  // Provenance is now a chip on the criterion's topline rather than a sentence
  // on its own line. It has to stay VISIBLE text — it is a boundary disclosure
  // under INV-4, and a hover tooltip discloses nothing on a touch screen — so
  // this asserts both the wording and that it is actually rendered.
  const provenance = page.locator('.evidence-provenance').first();
  await expect(provenance).toBeVisible();
  await expect(provenance).toContainText('semantic');
  await expect(provenance).toContainText('checked against your transcript');
  expect(analyzeCalls).toBe(1);
});

test('private source upload grounds the saved judge question with visible provenance', async ({ page }) => {
  const createdAt = '2026-08-12T08:00:00.000Z';
  const projectId = 'project-source-grounding';
  const rubricId = 'rubric-source-grounding';
  const attemptId = 'attempt-source-grounding';
  const sourceDocument = {
    id: 'source-proposal',
    projectId,
    blobUrl: 'https://private.example.test/source-proposal',
    filename: 'proposal.md',
    contentType: 'text/markdown',
    sizeBytes: 86,
    uploadedAt: createdAt,
  };
  const criteria = ['Problem clarity', 'Solution fit', 'Evidence', 'Feasibility'].map((name, index) => ({
    id: `criterion-source-${index}`,
    rubricId,
    name,
    description: `Explain ${name.toLocaleLowerCase('en-US')} with traceable evidence.`,
    requiredEvidence: ['evidence'],
    displayOrder: index,
  }));
  let uploadCalls = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    // A workspace that reports `persistence: 'neon'` has a signed-in owner, so
    // every surface that names a project asks which projects that owner has.
    // Leaving it unmocked returns a 404 the console records, and the gate
    // rightly fails on it.
    if (url.pathname === '/api/projects' && request.method() === 'GET') return respond({
      contractVersion: 2,
      identity: 'account',
      projects: [{
        project: {
          id: projectId,
          userId: 'user-source-grounding',
          title: 'Talk-Active · RISTEK Finals',
          eventContext: null,
          deadline: null,
          createdAt,
          updatedAt: createdAt,
        },
        attemptCount: 1,
        lastAttemptAt: createdAt,
        rubricConfirmed: true,
      }],
    });
    if (url.pathname === '/api/capabilities') return respond({
      contractVersion: 2,
      persistence: 'neon',
      accounts: false,
      sourceDocuments: true,
      recordings: false,
      semantic: { rubric: false, evidence: false, question: false, defense: false },
    });
    // This visitor has no owned project to restore. The route still has to
    // answer: an unmocked probe falls through to the 404 below, which is a
    // console error the afterEach hook is right to fail on.
    if (url.pathname === '/api/projects/current') return respond({
      contractVersion: 2,
      identity: 'guest',
      current: null,
    });
    if (url.pathname === '/api/projects' && request.method() === 'POST') return respond({
      contractVersion: 2,
      project: {
        id: projectId, userId: null, title: 'Finals rehearsal',
        eventContext: '7-minute pitch · 3-minute Q&A', deadline: '2026-08-14',
        createdAt, updatedAt: createdAt,
      },
    });
    if (url.pathname === `/api/projects/${projectId}/rubric` && request.method() === 'PUT') {
      return respond({
        contractVersion: 2,
        rubric: { id: rubricId, projectId, sourceType: 'manual', confirmedAt: createdAt, createdAt },
        criteria,
      });
    }
    if (url.pathname === `/api/projects/${projectId}/sources` && request.method() === 'POST') {
      uploadCalls += 1;
      expect(request.headers()['content-type']).toContain('multipart/form-data');
      return respond({ contractVersion: 2, sourceDocument });
    }
    if (url.pathname === '/api/attempts' && request.method() === 'POST') return respond({
      contractVersion: 2,
      attempt: {
        id: attemptId, projectId, mode: 'typed', status: 'draft',
        transcript: 'Talk-Active starts from the evaluator rubric and maps each verdict to evidence.',
        transcriptSource: 'typed', durationSeconds: 90, createdAt, completedAt: null,
      },
    });
    if (url.pathname === `/api/attempts/${attemptId}/evidence` && request.method() === 'POST') {
      return respond({
        contractVersion: 2,
        attemptId,
        verdicts: criteria.map((criterion, index) => ({
          id: `verdict-source-${index}`,
          attemptId,
          criterionId: criterion.id,
          stage: 'initial',
          verdict: 'unsupported',
          coverageScore: 0,
          citedSpan: null,
          missingEvidence: ['evidence'],
          engine: 'deterministic',
          verifierAgreed: null,
          verifierNote: null,
          studentOverridden: false,
          studentOverrideVerdict: null,
          createdAt,
        })),
        reusedCitations: [],
        degraded: true,
      });
    }
    if (url.pathname === `/api/attempts/${attemptId}/question` && request.method() === 'POST') {
      return respond({
        contractVersion: 2,
        question: {
          id: 'question-source-grounding', attemptId,
          targetCriterionId: criteria[0]?.id,
          questionText: 'How does this interview finding establish the problem your product must solve?',
          challengedClaim: 'Students receive rubric feedback only after final submission.',
          basis: 'source-document', sourceDocumentId: sourceDocument.id, createdAt,
        },
        sourceDocument,
        engine: 'deterministic',
        model: null,
        degradedReason: 'Semantic question generation is not configured.',
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/practice');
  await page.getByRole('button', { name: /Begin this attempt/i }).click();
  await expect(page.getByText('Ground the judge question in your material')).toBeVisible();
  await page.locator('#practiceSourceFile').setInputFiles({
    name: 'proposal.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Research\nStudents receive rubric feedback only after final submission.'),
  });
  await page.getByRole('button', { name: 'Attach privately' }).click();
  await expect(page.getByRole('status')).toContainText('proposal.md attached privately');
  await expect(page.locator('.production-source-list')).toContainText('proposal.md');
  expect(uploadCalls).toBe(1);

  await page.getByRole('button', { name: /Review this attempt/i }).click();
  await expect(page.getByRole('heading', { name: 'What your transcript actually supports' })).toBeVisible();
  await expect(page.getByText('Grounded in your private source:')).toContainText('proposal.md');
  await expect(page.locator('.judge-preview blockquote')).toContainText('interview finding');
  await expectVisibleControlsHitTest(page);
});

test('progress names a weakness only after it recurs and retains its evidence', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('talkactive.production.sessions.v1', JSON.stringify([
    {
      id: 'attempt-1', createdAt: '2026-08-11T08:00:00.000Z', evidenceScore: 50,
      weakest: 'Feasibility', defenseStatus: null, projectId: null,
      criteria: [{
        criterionId: 'criterion-feasibility', criterionName: 'Feasibility', verdict: 'unsupported',
        coverage: 0, citedSpan: null, missingEvidence: ['cost', 'timeline'],
      }],
    },
    {
      id: 'attempt-2', createdAt: '2026-08-12T08:00:00.000Z', evidenceScore: 75,
      weakest: 'Feasibility', defenseStatus: 'developing', projectId: null,
      criteria: [{
        criterionId: 'criterion-feasibility', criterionName: 'Feasibility', verdict: 'partial',
        coverage: 0.5, citedSpan: 'The deterministic fallback keeps the demo usable.', missingEvidence: ['measured cost'],
      }],
    },
  ])));
  await page.goto('/progress');
  await expect(page.getByRole('heading', { name: 'What changed between the last two reviewed attempts' })).toBeVisible();
  const feasibilityDiff = page.locator('.attempt-diff-item').filter({ hasText: 'Feasibility' });
  await expect(feasibilityDiff).toContainText('explicit coverage improved · +50 points');
  await expect(feasibilityDiff.getByText('No cited transcript evidence.')).toBeVisible();
  await expect(feasibilityDiff.locator('blockquote')).toHaveText('The deterministic fallback keeps the demo usable.');
  await expect(feasibilityDiff).toContainText('Still missing: measured cost.');
  await expect(page.locator('.recurring-item')).toHaveCount(1);
  // The sentence became a stat line so the criterion's trajectory could take
  // its place. Both facts it carried — how often, and how far below — are still
  // on screen, and the direction is now there too.
  await expect(page.locator('.recurring-item')).toContainText('2 of 2 attempts');
  await expect(page.locator('.recurring-item')).toContainText('25% average coverage');
  await expect(page.locator('.recurring-item .criterion-spark')).toHaveAttribute('data-direction', 'rising');
  await expect(page.locator('.recurring-evidence blockquote')).toHaveText('The deterministic fallback keeps the demo usable.');
  await expect(page.getByText(/Latest explicit gaps: measured cost/i)).toBeVisible();
  await expectVisibleControlsHitTest(page);
});

// Restored 13 August. This check was removed alongside the rubric declutter,
// which also removed the import panel it exercises. Pasting the evaluator's own
// scoring matrix is the hero moment in docs/specs/2026-08-10-innovation-week.md,
// and /api/rubrics/parse had been left with no caller. A green suite that no
// longer contains this check says nothing about whether the demo works.
test('rubric import stays traceable and requires human confirmation', async ({ page }) => {
  await page.goto('/rubric');
  await expectVisibleControlsHitTest(page);

  await page.getByText('Import from a scoring matrix').click();
  await page.getByLabel('Paste the scoring matrix').fill(
    'Problem evidence | affected students, frequency, source\nFeasibility | architecture, cost, timeline',
  );
  await page.getByRole('button', { name: 'Structure these criteria' }).click();

  // Structured, and explicitly not saved yet.
  await expect(page.locator('[data-toast-variant="warning"]'))
    .toContainText('2 criteria structured in deterministic mode');
  await expect(page.getByRole('button', { name: 'Save rubric' })).toBeVisible();

  // Each imported row still says which sentence it came from. Without this the
  // criteria are unattributable and the import stops being auditable.
  await expect(page.locator('.production-source-quote')).toHaveCount(2);
  await expectVisibleControlsHitTest(page);
});

test('rubric editor caps the criteria list and keeps Save at the end', async ({ page }) => {
  await page.goto('/rubric');
  await expectVisibleControlsHitTest(page);
  const addCriterion = page.getByRole('button', { name: 'Add criterion' });
  await expect(page.locator('.rubric-row')).toHaveCount(4);
  await addCriterion.click();
  await expect(page.locator('.rubric-row')).toHaveCount(5);
  await expect(addCriterion).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save rubric' })).toBeVisible();
  await expect(page.locator('.rubric-status')).toHaveCount(0);
  await expectVisibleControlsHitTest(page);
});

test('rubric library remains editable, explicitly saved, and source-labelled', async ({ page }) => {
  await page.goto('/rubric');
  await page.getByRole('button', { name: /Skripsi defense/i }).click();
  await expect(page.locator('[data-toast-variant="warning"]')).toContainText(/starter loaded but not saved/iu);
  await expect(page.locator('.rubric-row')).toHaveCount(5);

  const firstCriterion = page.getByLabel('Criterion').first();
  await firstCriterion.fill('Research gap and urgency');
  await page.getByRole('button', { name: 'Save rubric' }).click();
  await expect(page.locator('[data-toast-variant="positive"]')).toContainText('5 confirmed criteria saved');
  await expect.poll(() => page.evaluate(() => localStorage.getItem(
    'talkactive.production.rubric-source.v1',
  ))).toBe('library');

  await page.reload();
  await expect(page.getByLabel('Criterion').first()).toHaveValue('Research gap and urgency');
  await expect(page.locator('.rubric-row')).toHaveCount(5);
  await expectVisibleControlsHitTest(page);
});

test('mobile workspace exposes the complete frozen navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace');
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(4);
  await expectVisibleControlsHitTest(page);
  await nav.getByRole('link', { name: /Rubric/i }).click();
  await expect(page).toHaveURL(/\/rubric$/u);
  await expect(page.getByRole('heading', { name: 'Modify rubric' })).toBeVisible();
});

test('account sync is optional and fails closed when secrets are absent', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('talkactive.workspace.v1', JSON.stringify({
    version: 1,
    projects: [{ id: 'legacy', name: 'Legacy project' }],
    sessions: [],
  })));
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Sinkronisasi akun belum dikonfigurasi di sini.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue as guest' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mulai latihan lokal' })).toBeVisible();
  await expectVisibleControlsHitTest(page);

  const session = await request.get('/api/auth/get-session');
  expect(session.status()).toBe(503);
  await expect(session.json()).resolves.toMatchObject({
    error: { code: 'accounts_unavailable', retryable: false },
  });

  const sourceBefore = await page.evaluate(() => localStorage.getItem('talkactive.workspace.v1'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Ekspor data lokal' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('talk-active-local-export.json');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('talkactive.workspace.v1'))).toBe(sourceBefore);
});

// An attempt belongs to an account, so this route now answers a stranger with
// 401 rather than reporting whether its limiter happens to be configured. That
// ordering is deliberate: infrastructure state is not something to disclose to
// an unauthenticated caller.
test('an attempt-scoped model route refuses a stranger before anything else', async ({ request }) => {
  const response = await request.post('/api/attempts/019ff7f4-e54b-7aaa-baba-123456789abc/question', {
    headers: { 'x-vercel-forwarded-for': '203.0.113.44' },
  });

  expect(response.status()).toBe(401);
});

// The guest-reachable route is where INV-7 has to hold: an unconfigured limiter
// must stop the request loudly, before any spend, rather than quietly letting a
// model call through unmetered.
test('the guest model route fails loudly before spend when its limiter is unavailable', async ({ request }) => {
  const response = await request.post('/api/analyze', {
    headers: { 'x-vercel-forwarded-for': '203.0.113.44' },
    data: {
      transcript: 'We map every claim in the transcript back to a criterion in the rubric.',
      durationSeconds: 45,
      criteria: [{
        id: '019ff7f4-e54b-7aaa-baba-1234567890ab',
        name: 'Rubric grounding',
        description: 'Every verdict points at the transcript.',
        requiredEvidence: ['rubric', 'criterion'],
        displayOrder: 0,
      }],
    },
  });

  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toEqual({
    contractVersion: 2,
    error: {
      code: 'ai_rate_limit_unavailable',
      message: 'Semantic analysis is unavailable because its private rate limiter is not configured.',
      retryable: true,
    },
  });
});
