#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findBrowser } from './browser-paths.mjs';
import { createServer as createAppServer } from './serve.mjs';

export { findBrowser };

function quoted(value) {
  return JSON.stringify(String(value));
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function freePort() {
  const probe = createNetServer();
  const address = await listen(probe, 0, '127.0.0.1');
  const port = typeof address === 'object' && address ? address.port : 0;
  await close(probe);
  return port;
}

async function waitForPage(debugPort, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page');
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // Browser startup is asynchronous; the next attempt is authoritative.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('headless browser did not expose the Talk-Active page');
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('could not connect to browser')), { once: true });
  });
  return {
    ready,
    call(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'browser evaluation failed');
  return response.result.value;
}

async function waitFor(cdp, expression, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(cdp, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`browser condition timed out: ${expression}`);
}

function screenshotArgument(args) {
  const index = args.indexOf('--screenshot');
  return index >= 0 ? args[index + 1] ?? null : null;
}

function derivedScreenshotPath(path, suffix) {
  return path.endsWith('.png') ? `${path.slice(0, -4)}-${suffix}.png` : `${path}-${suffix}.png`;
}

async function captureViewport(cdp, path) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const capture = await cdp.call('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
  });
  writeFileSync(path, Buffer.from(capture.data, 'base64'));
}

async function run() {
  const browserPath = findBrowser();
  if (!browserPath) {
    process.stdout.write([
      'browser:',
      '  status: skipped',
      `  reason: ${quoted('no Chrome or Playwright Chromium executable found')}`,
      `help: ${quoted('Set CHROME_BIN to run the rendered interaction gate')}`,
    ].join('\n') + '\n');
    return;
  }

  const appServer = createAppServer();
  const address = await listen(appServer, 0, '127.0.0.1');
  const appPort = typeof address === 'object' && address ? address.port : 0;
  const debugPort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'talkactive-browser-'));
  const url = `http://127.0.0.1:${appPort}`;
  const browser = spawn(browserPath, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1100',
    url,
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const page = await waitForPage(debugPort);
    cdp = connectCdp(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#homeView')?.classList.contains('is-visible')`);

    const workspace = await evaluate(cdp, `(() => ({
      title: document.title,
      heading: document.querySelector('#homeTitle')?.textContent.trim(),
      appShell: Boolean(document.querySelector('.app-shell')),
      marketingHero: Boolean(document.querySelector('.hero, #runDemo')),
      projects: document.querySelectorAll('.sidebar-project').length,
      sessions: document.querySelectorAll('#recentSessions .session-row').length,
      stored: Boolean(localStorage.getItem('talkactive.workspace.v1')),
      mascotLoaded: Boolean(document.querySelector('.focus-mascot')?.complete && document.querySelector('.focus-mascot')?.naturalWidth),
      mascotFit: getComputedStyle(document.querySelector('.focus-mascot')).objectFit,
      coachPrompt: document.querySelector('#coachPrompt')?.textContent.trim(),
      brandText: document.querySelector('.brand-wordmark')?.textContent.trim(),
      brandLockups: document.querySelectorAll('.brand-wordmark').length,
      homeHeaderBorder: getComputedStyle(document.querySelector('.home-header')).borderTopWidth,
      homeHeaderShadow: getComputedStyle(document.querySelector('.home-header')).boxShadow,
      focusShadow: getComputedStyle(document.querySelector('.focus-card')).boxShadow,
      nextSessionShadow: getComputedStyle(document.querySelector('.next-session')).boxShadow,
      rubricHealthShadow: getComputedStyle(document.querySelector('.rubric-health')).boxShadow,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inaccessibleFields: [...document.querySelectorAll('textarea, input, select')].filter((field) => {
        const hasLabel = field.id && document.querySelector('label[for="' + field.id + '"]');
        return !hasLabel && !field.getAttribute('aria-label') && !field.closest('label');
      }).length
    }))()`);
    assert.match(workspace.title, /Rehearsal workspace/u);
    assert.match(workspace.heading, /next answer/u);
    assert.equal(workspace.appShell, true);
    assert.equal(workspace.marketingHero, false);
    assert.equal(workspace.projects, 1);
    assert.equal(workspace.sessions, 2);
    assert.equal(workspace.stored, true);
    assert.equal(workspace.mascotLoaded, true);
    assert.equal(workspace.mascotFit, 'contain');
    assert.ok(workspace.coachPrompt.length > 20);
    assert.equal(workspace.brandText, 'Talk-Active');
    assert.equal(workspace.brandLockups, 2);
    assert.equal(workspace.homeHeaderBorder, '2px');
    assert.notEqual(workspace.homeHeaderShadow, 'none');
    assert.notEqual(workspace.focusShadow, 'none');
    assert.notEqual(workspace.nextSessionShadow, 'none');
    assert.notEqual(workspace.rubricHealthShadow, 'none');
    assert.equal(workspace.overflow, 0);
    assert.equal(workspace.inaccessibleFields, 0);

    await cdp.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const reducedMotion = await evaluate(cdp, `(() => ({
      preferenceMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      mascotAnimation: getComputedStyle(document.querySelector('.focus-mascot')).animationName
    }))()`);
    assert.equal(reducedMotion.preferenceMatches, true);
    assert.equal(reducedMotion.mascotAnimation, 'none');
    await cdp.call('Emulation.setEmulatedMedia', { features: [] });

    const screenshotPath = screenshotArgument(process.argv.slice(2));
    const briefLink = await evaluate(cdp, `document.querySelector('.sidebar a[href="/brief.html"]')?.href`);
    assert.equal(briefLink, `${url}/brief.html`);

    await cdp.call('Page.navigate', { url: `${url}/brief.html` });
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#briefTitle')`);
    const brief = await evaluate(cdp, `(() => ({
      title: document.title,
      heading: document.querySelector('#briefTitle')?.textContent,
      main: Boolean(document.querySelector('main.brief-shell')),
      landingStylesheet: Boolean(document.querySelector('link[href="/src/landing.css"]')),
      mascot: document.querySelector('.landing-mascot')?.getAttribute('alt'),
      mascotSource: document.querySelector('.landing-mascot')?.getAttribute('src'),
      brandText: document.querySelector('.brief-brand .brand-wordmark')?.textContent.trim(),
      gapAsset: Boolean(document.querySelector('.landing-gap-asset')),
      loopArrowLoaded: Boolean(document.querySelector('.landing-loop-arrow')?.complete && document.querySelector('.landing-loop-arrow')?.naturalWidth),
      evidenceStamp: Boolean(document.querySelector('.landing-evidence-stamp')),
      closingLogo: document.querySelector('.landing-closing-logo')?.textContent.trim(),
      problem: document.querySelector('#problemTitle')?.textContent,
      loopSteps: document.querySelectorAll('.brief-loop-grid > li').length,
      evidenceTrace: document.querySelector('.brief-evidence-card')?.getAttribute('aria-label'),
      boundary: document.querySelector('.brief-boundaries')?.textContent,
      practiceTarget: document.querySelector('.landing-primary-cta')?.getAttribute('href'),
      workspaceTarget: document.querySelector('.brief-closing a')?.getAttribute('href'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }))()`);
    assert.match(brief.title, /Talk-Active/u);
    assert.match(brief.heading, /claims judges will score/u);
    assert.equal(brief.main, true);
    assert.equal(brief.landingStylesheet, true);
    assert.match(brief.mascot, /full-body 3D speaking bird/u);
    assert.equal(brief.mascotSource, '/src/assets/macaw-mascot-3d.webp');
    assert.equal(brief.brandText, 'Talk-Active');
    assert.equal(brief.gapAsset, true);
    assert.equal(brief.loopArrowLoaded, true);
    assert.equal(brief.evidenceStamp, true);
    assert.equal(brief.closingLogo, 'Talk-Active');
    assert.match(brief.problem, /evidence implicit/u);
    assert.equal(brief.loopSteps, 6);
    assert.equal(brief.evidenceTrace, 'Illustrative evidence trace');
    assert.match(brief.boundary, /not confidence or speaking ability/u);
    assert.equal(brief.practiceTarget, '/#practice');
    assert.equal(brief.workspaceTarget, '/#home');
    assert.equal(brief.overflow, 0);
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'brief-desktop'));

    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 810, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.call('Page.navigate', { url: `${url}/booth.html` });
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#boothTitle')`);
    const booth = await evaluate(cdp, `(() => ({
      title: document.querySelector('#boothTitle')?.textContent,
      loopSteps: document.querySelectorAll('.booth-loop > li').length,
      qrLoaded: Boolean(document.querySelector('.booth-qr-card img')?.complete && document.querySelector('.booth-qr-card img')?.naturalWidth),
      officialLogoLoaded: Boolean(document.querySelector('.booth-event-logo img')?.complete && document.querySelector('.booth-event-logo img')?.naturalWidth),
      boundary: document.querySelector('.booth-footer')?.textContent,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      clipped: [...document.querySelectorAll('body *')].filter((element) => {
        const box = element.getBoundingClientRect();
        return box.right > innerWidth + 1 || box.bottom > innerHeight + 1;
      }).slice(0, 6).map((element) => element.tagName.toLowerCase() + (element.className ? '.' + String(element.className).trim().replace(/\\s+/g, '.') : ''))
    }))()`);
    assert.match(booth.title, /Bring the rubric/u);
    assert.match(booth.title, /judge will challenge/u);
    assert.equal(booth.loopSteps, 4);
    assert.equal(booth.qrLoaded, true);
    assert.equal(booth.officialLogoLoaded, true);
    assert.match(booth.boundary, /not confidence or speaking ability/iu);
    assert.equal(booth.overflowX, 0);
    assert.equal(booth.overflowY, 0);
    assert.deepEqual(booth.clipped, [], `booth display clips: ${booth.clipped.join(', ')}`);
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'booth-display'));

    await cdp.call('Page.navigate', { url: `${url}/brief.html` });
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#briefTitle')`);

    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await cdp.call('Page.reload');
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#briefTitle')`);
    const briefMobile = await evaluate(cdp, `(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clippedElements: [...document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length,
      clippedLabels: [...document.querySelectorAll('body *')]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 6)
        .map((element) => element.tagName.toLowerCase() + (element.className ? '.' + String(element.className).trim().replace(/\\s+/g, '.') : '')),
      loopColumns: getComputedStyle(document.querySelector('.brief-loop-grid')).gridTemplateColumns,
      ctaHeight: document.querySelector('.brief-topbar-cta').getBoundingClientRect().height,
      mascotWidth: document.querySelector('.landing-mascot').getBoundingClientRect().width,
      mascotVisible: getComputedStyle(document.querySelector('.landing-mascot')).display !== 'none'
    }))()`);
    assert.equal(briefMobile.overflow, 0);
    assert.equal(briefMobile.clippedElements, 0, `mobile landing clips: ${briefMobile.clippedLabels.join(', ')}`);
    assert.ok(!briefMobile.loopColumns.includes(' '));
    assert.ok(briefMobile.ctaHeight >= 44);
    assert.ok(briefMobile.mascotWidth >= 180);
    assert.equal(briefMobile.mascotVisible, true);
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'brief-mobile'));

    await evaluate(cdp, `document.querySelector('.brief-closing a').click()`);
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#homeView')?.classList.contains('is-visible')`);
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.call('Page.reload');
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#homeView')?.classList.contains('is-visible')`);

    await evaluate(cdp, `document.querySelector('[data-start-practice]').click()`);
    await waitFor(cdp, `document.querySelector('#practiceView')?.classList.contains('is-visible') && document.querySelector('#practiceSetup')?.classList.contains('is-visible')`);
    const setup = await evaluate(cdp, `(() => ({
      project: document.querySelector('#setupProjectName')?.textContent,
      criteria: document.querySelectorAll('#setupCriteria .setup-criterion').length,
      steps: document.querySelectorAll('.practice-steps li').length,
      workflowMarkLoaded: Boolean(document.querySelector('#practiceView .workflow-mark')?.complete && document.querySelector('#practiceView .workflow-mark')?.naturalWidth),
      headerShadow: getComputedStyle(document.querySelector('#practiceView .workflow-header')).boxShadow,
      markShadow: getComputedStyle(document.querySelector('#practiceView .workflow-mark')).boxShadow,
      setupFormEdge: getComputedStyle(document.querySelector('.setup-form')).borderTopWidth,
      setupRubricEdge: getComputedStyle(document.querySelector('.setup-rubric')).borderTopWidth
    }))()`);
    assert.match(setup.project, /RISTEK Hackathon/u);
    assert.equal(setup.criteria, 4);
    assert.equal(setup.steps, 4);
    assert.equal(setup.workflowMarkLoaded, true);
    assert.equal(setup.headerShadow, 'none');
    assert.equal(setup.markShadow, 'none');
    assert.equal(setup.setupFormEdge, '2px');
    assert.equal(setup.setupRubricEdge, '2px');
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'practice'));

    await evaluate(cdp, `document.querySelector('#beginAttempt').click()`);
    await waitFor(cdp, `document.querySelector('#practiceAttempt')?.classList.contains('is-visible')`);
    const attempt = await evaluate(cdp, `(() => ({
      draftLength: document.querySelector('#attemptTranscript')?.value.length,
      duration: Number(document.querySelector('#attemptDuration')?.value),
      savedCopy: document.querySelector('#draftStatus')?.textContent
    }))()`);
    assert.ok(attempt.draftLength > 200);
    assert.ok(attempt.duration > 0);
    assert.match(attempt.savedCopy, /saved locally/u);

    // The local client must attempt the same semantic endpoint as production,
    // while this gate deliberately forces the offline path without spending a
    // real Gateway credit.
    await evaluate(cdp, `(() => {
      const nativeFetch = window.fetch.bind(window);
      window.__talkactiveApiAttempts = 0;
      window.fetch = async (resource, options) => {
        if (resource === '/api/analyze') {
          window.__talkactiveApiAttempts += 1;
          return new Response(JSON.stringify({ error: 'analysis_failed' }), {
            status: 503, headers: { 'content-type': 'application/json' }
          });
        }
        return nativeFetch(resource, options);
      };
    })()`);
    await evaluate(cdp, `document.querySelector('#analyzeAttempt').click()`);
    await waitFor(cdp, `document.querySelector('#practiceReview')?.classList.contains('is-visible')`);
    const review = await evaluate(cdp, `(() => ({
      score: Number(document.querySelector('#reviewScore')?.textContent.replace('%', '')),
      weakest: document.querySelector('#reviewWeakest')?.textContent,
      question: document.querySelector('#reviewQuestion')?.textContent,
      criteria: document.querySelectorAll('#reviewCriteria .evidence-item').length,
      provenanceNotes: document.querySelectorAll('#reviewCriteria .evidence-provenance').length,
      reviewText: document.querySelector('#reviewCriteria')?.textContent,
      apiAttempts: window.__talkactiveApiAttempts,
      completedSteps: document.querySelectorAll('.practice-steps .is-complete').length,
      heroShadow: getComputedStyle(document.querySelector('.review-hero')).boxShadow,
      judgePreviewShadow: getComputedStyle(document.querySelector('.judge-preview')).boxShadow
    }))()`);
    assert.ok(review.score > 0 && review.score < 100);
    assert.equal(review.weakest, 'Differentiation');
    assert.match(review.question, /unique product logic/u);
    assert.equal(review.criteria, 4);
    assert.equal(review.provenanceNotes, 4);
    assert.equal(review.apiAttempts, 1);
    assert.match(review.reviewText, /cue matching/u);
    assert.equal(review.completedSteps, 2);
    assert.equal(review.heroShadow, 'none');
    assert.equal(review.judgePreviewShadow, 'none');

    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'review'));

    await evaluate(cdp, `document.querySelector('#openDefense').click()`);
    await waitFor(cdp, `document.querySelector('#practiceDefense')?.classList.contains('is-visible')`);
    await evaluate(cdp, `(() => {
      const answer = document.querySelector('#defenseAnswer');
      answer.value = "Unlike generic competitors, Talk-Active uses unique logic that keeps every critique traceable to the active rubric and transcript.";
      answer.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#evaluateDefense').click();
    })()`);
    await waitFor(cdp, `document.querySelector('#defenseResult')?.hidden === false`);
    const defense = await evaluate(cdp, `(() => ({
      status: document.querySelector('#defenseStatus')?.textContent,
      score: document.querySelector('#defenseScore')?.textContent,
      matched: document.querySelectorAll('#matchedSignals .signal-chip.matched').length,
      followUp: document.querySelector('#defenseFollowUp')?.textContent,
      workspaceShadow: getComputedStyle(document.querySelector('.defense-workspace')).boxShadow
    }))()`);
    assert.equal(defense.status, 'defensible');
    assert.equal(defense.score, '100%');
    assert.equal(defense.matched, 4);
    assert.match(defense.followUp, /user evidence/u);
    assert.equal(defense.workspaceShadow, 'none');
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'defense'));

    await evaluate(cdp, `document.querySelector('#saveSession').click()`);
    await waitFor(cdp, `document.querySelector('#progressView')?.classList.contains('is-visible') && document.querySelector('#totalSessions')?.textContent === '3'`);
    const progress = await evaluate(cdp, `(() => ({
      sessions: document.querySelectorAll('#allSessions .session-row').length,
      bars: document.querySelectorAll('#progressChart .chart-bar').length,
      storedSessions: JSON.parse(localStorage.getItem('talkactive.workspace.v1')).sessions.length,
      toast: document.querySelector('#toast')?.hidden === false,
      workflowMarkLoaded: Boolean(document.querySelector('#progressView .workflow-mark')?.complete && document.querySelector('#progressView .workflow-mark')?.naturalWidth),
      chartEdge: getComputedStyle(document.querySelector('.progress-chart-card')).borderTopWidth
    }))()`);
    assert.equal(progress.sessions, 3);
    assert.equal(progress.bars, 3);
    assert.equal(progress.storedSessions, 3);
    assert.equal(progress.toast, true);
    assert.equal(progress.workflowMarkLoaded, true);
    assert.equal(progress.chartEdge, '2px');
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'progress'));

    await evaluate(cdp, `document.querySelector('#sidebarAddProject').click()`);
    await waitFor(cdp, `document.querySelector('#projectDialog')?.open === true`);
    await evaluate(cdp, `(() => {
      document.querySelector('#projectName').value = 'Scholarship Interview';
      document.querySelector('#projectEvent').value = 'LPDP panel interview';
      document.querySelector('#projectDeadline').value = '2026-09-15';
      document.querySelector('#projectForm').requestSubmit();
    })()`);
    await waitFor(cdp, `document.querySelector('#rubricView')?.classList.contains('is-visible') && document.querySelectorAll('.sidebar-project').length === 2`);
    const created = await evaluate(cdp, `(() => ({
      projectName: document.querySelector('#rubricProjectName')?.textContent,
      rubricRows: document.querySelectorAll('#rubricEditor .rubric-row').length,
      storedProjects: JSON.parse(localStorage.getItem('talkactive.workspace.v1')).projects.length,
      workflowMarkLoaded: Boolean(document.querySelector('#rubricView .workflow-mark')?.complete && document.querySelector('#rubricView .workflow-mark')?.naturalWidth),
      editorEdge: getComputedStyle(document.querySelector('.rubric-editor-card')).borderTopWidth
    }))()`);
    assert.equal(created.projectName, 'Scholarship Interview');
    assert.equal(created.rubricRows, 4);
    assert.equal(created.storedProjects, 2);
    assert.equal(created.workflowMarkLoaded, true);
    assert.equal(created.editorEdge, '2px');
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'rubric'));

    const storedRubricBeforeImport = await evaluate(cdp, `JSON.parse(localStorage.getItem('talkactive.workspace.v1')).projects.find((project) => project.name === 'Scholarship Interview')?.rubric`);
    await evaluate(cdp, `(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (resource, options) => {
        if (resource === '/api/import-rubric') {
          return {
            ok: true,
            json: async () => ({ rubricText: 'Technical Execution | prototype, works live\\nPitching and Q&A | clarity, handles questions' })
          };
        }
        return nativeFetch(resource, options);
      };
      document.querySelector('#rubricImportInput').value = 'Technical Execution 30%\\nPitching and Q&A 20%';
      document.querySelector('#rubricImportButton').click();
    })()`);
    await waitFor(cdp, `document.querySelector('#rubricImportStatus')?.textContent.includes('2 criteria ready')`);
    const imported = await evaluate(cdp, `(() => ({
      rows: document.querySelectorAll('#rubricEditor .rubric-row').length,
      labels: [...document.querySelectorAll('.criterion-label-input')].map((input) => input.value),
      source: document.querySelector('#rubricImportInput').value,
      storedRubric: JSON.parse(localStorage.getItem('talkactive.workspace.v1')).projects.find((project) => project.name === 'Scholarship Interview')?.rubric
    }))()`);
    assert.equal(imported.rows, 2);
    assert.deepEqual(imported.labels, ['Technical Execution', 'Pitching and Q&A']);
    assert.match(imported.source, /Technical Execution 30%/u);
    assert.equal(imported.storedRubric, storedRubricBeforeImport, 'imported criteria stay unsaved until confirmation');

    await evaluate(cdp, `document.querySelector('#saveRubric').click()`);
    await waitFor(cdp, `JSON.parse(localStorage.getItem('talkactive.workspace.v1')).projects.find((project) => project.name === 'Scholarship Interview')?.rubric.startsWith('Technical Execution')`);

    await evaluate(cdp, `(() => {
      const firstLabel = document.querySelector('.criterion-label-input');
      firstLabel.value = 'User need';
      document.querySelector('#saveRubric').click();
    })()`);
    await waitFor(cdp, `JSON.parse(localStorage.getItem('talkactive.workspace.v1')).projects.find((project) => project.name === 'Scholarship Interview')?.rubric.startsWith('User need')`);

    await cdp.call('Page.reload');
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelectorAll('.sidebar-project').length === 2`);
    const persisted = await evaluate(cdp, `(() => ({
      projects: JSON.parse(localStorage.getItem('talkactive.workspace.v1')).projects.length,
      sessions: JSON.parse(localStorage.getItem('talkactive.workspace.v1')).sessions.length,
      rubric: JSON.parse(localStorage.getItem('talkactive.workspace.v1')).projects.find((project) => project.name === 'Scholarship Interview')?.rubric
    }))()`);
    assert.equal(persisted.projects, 2);
    assert.equal(persisted.sessions, 3);
    assert.match(persisted.rubric, /^User need/u);

    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await evaluate(cdp, `document.querySelector('[data-route="home"]')?.click()`);
    const mobile = await evaluate(cdp, `(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mobileNav: getComputedStyle(document.querySelector('.mobile-nav')).display,
      sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
      focusColumns: getComputedStyle(document.querySelector('.focus-card')).gridTemplateColumns,
      homeHeaderShadow: getComputedStyle(document.querySelector('.home-header')).boxShadow
    }))()`);
    assert.equal(mobile.overflow, 0);
    assert.notEqual(mobile.mobileNav, 'none');
    assert.equal(mobile.sidebar, 'none');
    assert.ok(!mobile.focusColumns.includes(' '));
    assert.notEqual(mobile.homeHeaderShadow, 'none');
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'mobile'));

    for (const route of ['practice', 'rubric', 'progress']) {
      await evaluate(cdp, `document.querySelector('.mobile-nav [data-route="${route}"]').click()`);
      await waitFor(cdp, `document.querySelector('#${route}View')?.classList.contains('is-visible')`);
      const mobileWorkflow = await evaluate(cdp, `(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        markWidth: document.querySelector('#${route}View .workflow-mark')?.getBoundingClientRect().width,
        headerBorder: getComputedStyle(document.querySelector('#${route}View .workflow-header')).borderBottomWidth
      }))()`);
      assert.equal(mobileWorkflow.overflow, 0);
      assert.ok(mobileWorkflow.markWidth >= 44);
      assert.equal(mobileWorkflow.headerBorder, '2px');
      if (route === 'progress') {
        const emptyProgress = await evaluate(cdp, `(() => ({
          total: document.querySelector('#totalSessions')?.textContent,
          chart: document.querySelector('#progressChart .chart-empty')?.textContent,
          archive: document.querySelector('#allSessions .empty-list')?.textContent
        }))()`);
        assert.equal(emptyProgress.total, '0');
        assert.match(emptyProgress.chart, /Practise twice/iu);
        assert.match(emptyProgress.archive, /No sessions saved/iu);
      }
      if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, `mobile-${route}`));
    }

    if (screenshotPath) {
      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
      });
      await evaluate(cdp, `document.querySelector('.mobile-nav [data-route="home"]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await captureViewport(cdp, screenshotPath);
    }

    const checks = [
      ['product-workspace', 'passed'],
      ['reduced-motion', 'passed'],
      ['product-brief', 'passed'],
      ['product-brief-mobile', 'passed'],
      ['booth-display', 'passed'],
      ['accessible-fields', 'passed'],
      ['persistent-project-state', 'passed'],
      ['practice-setup', 'passed'],
      ['rubric-grounded-review', 'passed'],
      ['criterion-provenance', 'passed'],
      ['judge-defense', 'passed'],
      ['session-history', 'passed'],
      ['project-creation', 'passed'],
      ['rubric-import', 'passed'],
      ['rubric-editing', 'passed'],
      ['reload-persistence', 'passed'],
      ['empty-states', 'passed'],
      ['mobile-layout', 'passed'],
    ];
    process.stdout.write([
      'browser:',
      '  status: passed',
      `  engine: ${quoted(basename(browserPath))}`,
      `checks[${checks.length}]{id,status}:`,
      ...checks.map(([id, status]) => `  ${id},${status}`),
    ].join('\n') + '\n');
  } finally {
    cdp?.close();
    await terminate(browser);
    await close(appServer);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// Only run when invoked directly. design-preview.mjs imports findBrowser from
// here, and without this guard that import silently executed the entire browser
// suite as a side effect — doubling the runtime of every preview.
const INVOKED_DIRECTLY = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (INVOKED_DIRECTLY) {
  run().catch((error) => {
    process.stdout.write([
      `error: ${quoted(error.message)}`,
      `help: ${quoted('Run `pnpm test:browser -- --screenshot /tmp/talkactive.png` to inspect the rendered state')}`,
    ].join('\n') + '\n');
    process.exitCode = 1;
  });
}
