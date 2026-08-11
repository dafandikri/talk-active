#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createServer as createAppServer } from './serve.mjs';

const BROWSER_NAMES = new Set([
  'chrome-headless-shell', 'headless_shell', 'Google Chrome', 'Chromium',
  'chrome-headless-shell.exe', 'headless_shell.exe', 'chrome.exe',
]);

function quoted(value) {
  return JSON.stringify(String(value));
}

function walkForBrowser(directory, depth = 0) {
  if (!directory || !existsSync(directory) || depth > 4) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isFile() && BROWSER_NAMES.has(entry.name)) found.push(fullPath);
    else if (entry.isDirectory()) found.push(...walkForBrowser(fullPath, depth + 1));
  }
  return found;
}

// A missing browser makes this gate report "skipped" and exit 0, so a machine
// this function cannot see a browser on runs `pnpm check` green while never
// exercising the demo path — the merge permission is granted by a gate that did
// not run. CI installs Chromium and fails on "status: skipped" for exactly that
// reason; a developer laptop has no such guard, so the search has to cover the
// platforms the team actually works on.
const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local');

export function findBrowser() {
  const explicit = process.env.CHROME_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  const installed = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    join(localAppData, 'Google/Chrome/Application/chrome.exe'),
  ].find((candidate) => existsSync(candidate));
  if (installed) return installed;
  const cacheRoots = [
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
    join(localAppData, 'ms-playwright'),
  ];
  return cacheRoots.flatMap((root) => walkForBrowser(root)).sort().reverse()[0] ?? null;
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
    assert.equal(brief.mascotSource, '/src/assets/cockatoo-mascot-3d.webp');
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

    await evaluate(cdp, `document.querySelector('#analyzeAttempt').click()`);
    await waitFor(cdp, `document.querySelector('#practiceReview')?.classList.contains('is-visible')`);
    const review = await evaluate(cdp, `(() => ({
      score: Number(document.querySelector('#reviewScore')?.textContent.replace('%', '')),
      weakest: document.querySelector('#reviewWeakest')?.textContent,
      question: document.querySelector('#reviewQuestion')?.textContent,
      criteria: document.querySelectorAll('#reviewCriteria .evidence-item').length,
      completedSteps: document.querySelectorAll('.practice-steps .is-complete').length,
      heroShadow: getComputedStyle(document.querySelector('.review-hero')).boxShadow,
      judgePreviewShadow: getComputedStyle(document.querySelector('.judge-preview')).boxShadow
    }))()`);
    assert.ok(review.score > 0 && review.score < 100);
    assert.equal(review.weakest, 'Differentiation');
    assert.match(review.question, /unique product logic/u);
    assert.equal(review.criteria, 4);
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

    // A booth device passes from visitor to visitor with no account to log out
    // of, so reset is the handover. It must restore the seed workspace exactly,
    // and it must also clear the practice state held in memory — a stale
    // analysis would show the next visitor the previous one's evidence review
    // even though storage was already clean.
    //
    // The dictation language is the deliberate exception: it describes this
    // device's microphone, not the visitor's work.
    // Leave the workspace the way a visitor actually leaves it: mid-attempt, in
    // a later practice stage, with their own words in the box. Resetting from a
    // clean home screen would assert nothing, because the page load already put
    // the practice flow back to its first stage.
    await evaluate(cdp, `document.querySelector('[data-route="practice"]').click()`);
    await waitFor(cdp, `document.querySelector('#practiceView')?.classList.contains('is-visible')`);
    await evaluate(cdp, `document.querySelector('#beginAttempt').click()`);
    await waitFor(cdp, `document.querySelector('#practiceAttempt')?.classList.contains('is-visible')`);
    await evaluate(cdp, `(() => {
      const box = document.querySelector('#attemptTranscript');
      box.value = 'Half-finished words the previous visitor left behind.';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    await evaluate(cdp, `localStorage.setItem('talkactive.dictation.language', 'id-ID')`);
    await evaluate(cdp, `document.querySelector('#kioskReset').click()`);
    await waitFor(cdp, `document.querySelectorAll('.sidebar-project').length === 1`);
    const kioskReset = await evaluate(cdp, `(() => {
      const stored = JSON.parse(localStorage.getItem('talkactive.workspace.v1'));
      return {
        projects: stored.projects.length,
        projectName: stored.projects[0]?.name,
        sessions: stored.sessions.length,
        landedHome: document.querySelector('#homeView')?.classList.contains('is-visible'),
        practiceReset: document.querySelector('[data-practice-stage="setup"]')?.classList.contains('is-visible'),
        dictationLanguage: localStorage.getItem('talkactive.dictation.language')
      };
    })()`);
    assert.equal(kioskReset.projects, 1);
    assert.equal(kioskReset.projectName, 'Talk-Active — RISTEK Hackathon');
    assert.equal(kioskReset.sessions, 2);
    assert.equal(kioskReset.landedHome, true);
    assert.equal(kioskReset.practiceReset, true);
    assert.equal(kioskReset.dictationLanguage, 'id-ID');

    // A blank panel reads as a bug even when it is correct, so every view has
    // to say what to do next. The seed workspace is deliberately full, so the
    // empty conditions are constructed here rather than waited for.
    await evaluate(cdp, `(() => {
      localStorage.setItem('talkactive.workspace.v1', JSON.stringify({
        version: 1,
        activeProjectId: 'project-empty',
        projects: [{
          id: 'project-empty',
          name: 'Nothing yet',
          event: 'First rehearsal',
          deadline: '2026-09-01',
          rubric: '',
          draft: '',
          draftDuration: 90,
          createdAt: '2026-08-12T00:00:00.000Z'
        }],
        sessions: []
      }));
    })()`);
    await cdp.call('Page.reload');
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#homeView')?.classList.contains('is-visible')`);

    const emptyStates = await evaluate(cdp, `(() => {
      const readable = (selector) => {
        const node = document.querySelector(selector);
        return { text: node?.textContent.trim() ?? '', children: node?.children.length ?? -1 };
      };
      document.querySelector('[data-route="progress"]').click();
      document.querySelector('[data-route="rubric"]').click();
      return {
        home: readable('#recentSessions'),
        progress: readable('#progressChart'),
        allSessions: readable('#allSessions'),
        rubric: readable('#rubricEditor')
      };
    })()`);
    assert.match(emptyStates.home.text, /No attempts yet/u);
    assert.match(emptyStates.progress.text, /Practise twice/u);
    assert.match(emptyStates.rubric.text, /Add a criterion/u);
    assert.ok(emptyStates.allSessions.text.length > 0, 'the session list left a bare container');
    // Nothing is a container standing empty under its own heading: each one
    // holds the paragraph that explains itself.
    for (const [view, panel] of Object.entries(emptyStates)) {
      assert.equal(panel.children, 1, `${view} rendered ${panel.children} children instead of one empty-state paragraph`);
    }

    // Restore the workspace the rest of the gate and the demo expect.
    await evaluate(cdp, `localStorage.removeItem('talkactive.workspace.v1')`);
    await cdp.call('Page.reload');
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelectorAll('.sidebar-project').length === 1`);

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
      if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, `mobile-${route}`));
    }

    // The route loop above covers the four top-level views. The judge path also
    // runs through four practice stages, and those are where the wide things
    // live: a long transcript, quoted evidence spans, the defense panel. A
    // booth visitor reaches all of them on their own phone.
    const measureStage = async (stage) => {
      const reading = await evaluate(cdp, `(() => {
        const visible = (node) => node.getBoundingClientRect().width > 0;
        const controls = [...document.querySelectorAll('.view.is-visible button, .view.is-visible select, .mobile-nav button')].filter(visible);
        return {
          scrollWidth: document.documentElement.scrollWidth,
          undersized: controls
            .map((node) => {
              const box = node.getBoundingClientRect();
              return { label: (node.id || node.textContent || 'control').trim().slice(0, 32), height: Math.round(box.height), width: Math.round(box.width) };
            })
            .filter((target) => target.height < 44 || target.width < 44)
        };
      })()`);
      assert.ok(
        reading.scrollWidth <= 390,
        `${stage} overflows at 390px: scrollWidth ${reading.scrollWidth}`,
      );
      assert.deepEqual(
        reading.undersized, [],
        `${stage} has controls below the 44px minimum: ${JSON.stringify(reading.undersized)}`,
      );
    };

    await evaluate(cdp, `document.querySelector('.mobile-nav [data-route="practice"]').click()`);
    await waitFor(cdp, `document.querySelector('#practiceSetup')?.classList.contains('is-visible')`);
    await measureStage('practice-setup');

    await evaluate(cdp, `document.querySelector('#beginAttempt').click()`);
    await waitFor(cdp, `document.querySelector('#practiceAttempt')?.classList.contains('is-visible')`);
    await measureStage('practice-attempt');

    await evaluate(cdp, `document.querySelector('#analyzeAttempt').click()`);
    await waitFor(cdp, `document.querySelector('#practiceReview')?.classList.contains('is-visible')`);
    await measureStage('practice-review');

    await evaluate(cdp, `document.querySelector('#openDefense').click()`);
    await waitFor(cdp, `document.querySelector('#practiceDefense')?.classList.contains('is-visible')`);
    await measureStage('practice-defend');

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
      ['accessible-fields', 'passed'],
      ['persistent-project-state', 'passed'],
      ['practice-setup', 'passed'],
      ['rubric-grounded-review', 'passed'],
      ['judge-defense', 'passed'],
      ['session-history', 'passed'],
      ['project-creation', 'passed'],
      ['rubric-editing', 'passed'],
      ['reload-persistence', 'passed'],
      ['kiosk-reset', 'passed'],
      ['empty-states', 'passed'],
      ['mobile-layout', 'passed'],
      ['mobile-judge-path', 'passed'],
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
