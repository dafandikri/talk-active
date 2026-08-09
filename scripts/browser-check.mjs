#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

import { createServer as createAppServer } from './serve.mjs';

const BROWSER_NAMES = new Set(['chrome-headless-shell', 'headless_shell', 'Google Chrome', 'Chromium']);

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

export function findBrowser() {
  const explicit = process.env.CHROME_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  const installed = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find((candidate) => existsSync(candidate));
  if (installed) return installed;
  const cacheRoots = [
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
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
  const profile = mkdtempSync(join(tmpdir(), 'lancar-browser-'));
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
      stored: Boolean(localStorage.getItem('lancar.workspace.v1')),
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
    assert.equal(workspace.overflow, 0);
    assert.equal(workspace.inaccessibleFields, 0);

    await evaluate(cdp, `document.querySelector('[data-start-practice]').click()`);
    await waitFor(cdp, `document.querySelector('#practiceView')?.classList.contains('is-visible') && document.querySelector('#practiceSetup')?.classList.contains('is-visible')`);
    const setup = await evaluate(cdp, `(() => ({
      project: document.querySelector('#setupProjectName')?.textContent,
      criteria: document.querySelectorAll('#setupCriteria .setup-criterion').length,
      steps: document.querySelectorAll('.practice-steps li').length
    }))()`);
    assert.match(setup.project, /RISTEK Hackathon/u);
    assert.equal(setup.criteria, 4);
    assert.equal(setup.steps, 4);

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
      completedSteps: document.querySelectorAll('.practice-steps .is-complete').length
    }))()`);
    assert.ok(review.score > 0 && review.score < 100);
    assert.equal(review.weakest, 'Differentiation');
    assert.match(review.question, /unique product logic/u);
    assert.equal(review.criteria, 4);
    assert.equal(review.completedSteps, 2);

    const screenshotPath = screenshotArgument(process.argv.slice(2));
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
      followUp: document.querySelector('#defenseFollowUp')?.textContent
    }))()`);
    assert.equal(defense.status, 'defensible');
    assert.equal(defense.score, '100%');
    assert.equal(defense.matched, 4);
    assert.match(defense.followUp, /user evidence/u);
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'defense'));

    await evaluate(cdp, `document.querySelector('#saveSession').click()`);
    await waitFor(cdp, `document.querySelector('#progressView')?.classList.contains('is-visible') && document.querySelector('#totalSessions')?.textContent === '3'`);
    const progress = await evaluate(cdp, `(() => ({
      sessions: document.querySelectorAll('#allSessions .session-row').length,
      bars: document.querySelectorAll('#progressChart .chart-bar').length,
      storedSessions: JSON.parse(localStorage.getItem('lancar.workspace.v1')).sessions.length,
      toast: document.querySelector('#toast')?.hidden === false
    }))()`);
    assert.equal(progress.sessions, 3);
    assert.equal(progress.bars, 3);
    assert.equal(progress.storedSessions, 3);
    assert.equal(progress.toast, true);

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
      storedProjects: JSON.parse(localStorage.getItem('lancar.workspace.v1')).projects.length
    }))()`);
    assert.equal(created.projectName, 'Scholarship Interview');
    assert.equal(created.rubricRows, 4);
    assert.equal(created.storedProjects, 2);

    await evaluate(cdp, `(() => {
      const firstLabel = document.querySelector('.criterion-label-input');
      firstLabel.value = 'User need';
      document.querySelector('#saveRubric').click();
    })()`);
    await waitFor(cdp, `JSON.parse(localStorage.getItem('lancar.workspace.v1')).projects.find((project) => project.name === 'Scholarship Interview')?.rubric.startsWith('User need')`);

    await cdp.call('Page.reload');
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelectorAll('.sidebar-project').length === 2`);
    const persisted = await evaluate(cdp, `(() => ({
      projects: JSON.parse(localStorage.getItem('lancar.workspace.v1')).projects.length,
      sessions: JSON.parse(localStorage.getItem('lancar.workspace.v1')).sessions.length,
      rubric: JSON.parse(localStorage.getItem('lancar.workspace.v1')).projects.find((project) => project.name === 'Scholarship Interview')?.rubric
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
      focusColumns: getComputedStyle(document.querySelector('.focus-card')).gridTemplateColumns
    }))()`);
    assert.equal(mobile.overflow, 0);
    assert.notEqual(mobile.mobileNav, 'none');
    assert.equal(mobile.sidebar, 'none');
    assert.ok(!mobile.focusColumns.includes(' '));
    if (screenshotPath) await captureViewport(cdp, derivedScreenshotPath(screenshotPath, 'mobile'));

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
      ['accessible-fields', 'passed'],
      ['persistent-project-state', 'passed'],
      ['practice-setup', 'passed'],
      ['rubric-grounded-review', 'passed'],
      ['judge-defense', 'passed'],
      ['session-history', 'passed'],
      ['project-creation', 'passed'],
      ['rubric-editing', 'passed'],
      ['reload-persistence', 'passed'],
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

run().catch((error) => {
  process.stdout.write([
    `error: ${quoted(error.message)}`,
    `help: ${quoted('Run `pnpm test:browser -- --screenshot /tmp/lancar.png` to inspect the rendered state')}`,
  ].join('\n') + '\n');
  process.exitCode = 1;
});
