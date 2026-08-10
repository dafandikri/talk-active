#!/usr/bin/env node
// ============================================================================
//  DEMO GATE — the flow judges will actually watch, run adversarially.
//
//  Final Presentation scoring puts 30 points on Technical Execution, of which
//  10 are literally "the product functions smoothly without critical bugs
//  during the live demo". Exhibition puts another 30 on the interactive
//  prototype. This gate exists so that nobody discovers a console error on
//  stage on 14 August.
//
//  It is stricter than the feature gate in browser-check.mjs: any console
//  error, any uncaught exception, any failed request, and any state lost on
//  reload fails the build.
//
//    node scripts/demo-gate.mjs
// ============================================================================
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

import { createServer as createAppServer } from './serve.mjs';

// Deliberately not imported from browser-check.mjs: that module self-executes
// its own suite on import, which would run the feature gate twice.
const BROWSER_NAMES = new Set(['chrome-headless-shell', 'headless_shell', 'Google Chrome', 'Chromium']);

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

function findBrowser() {
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

const quoted = (value) => JSON.stringify(String(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}
const close = (server) => new Promise((resolve) => server.close(resolve));

async function freePort() {
  const probe = createNetServer();
  const address = await listen(probe, 0, '127.0.0.1');
  const port = address.port;
  await close(probe);
  return port;
}

async function waitForPage(debugPort, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (response.ok) {
        const page = (await response.json()).find((target) => target.type === 'page');
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // The browser is still starting; the next attempt is authoritative.
    }
    await sleep(100);
  }
  throw new Error('headless browser did not expose a page');
}

// Unlike the feature gate, this connection also listens for events, because the
// whole point is to catch what the product says when it thinks nobody is looking.
function connectCdp(url, problems, requests) {
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = message.params.args
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(' ');
      problems.push({ kind: 'console.error', detail: text });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      problems.push({
        kind: 'uncaught exception',
        detail: details.exception?.description ?? details.text,
      });
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      problems.push({ kind: 'network/log error', detail: message.params.entry.text });
    }
    if (message.method === 'Network.requestWillBeSent') {
      requests.push(message.params.request.url);
    }

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
    expression, returnByValue: true, awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'browser evaluation failed');
  }
  return response.result.value;
}

async function waitFor(cdp, expression, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch {
      // Mid-reload the execution context is destroyed and evaluation throws.
      // That is a transient state, not a defect; keep polling.
    }
    await sleep(80);
  }
  throw new Error(`demo path stalled waiting for: ${expression}`);
}

// Reload and wait until the fresh document is interactive again.
async function reload(cdp) {
  await cdp.call('Page.reload');
  await sleep(250);
  await waitFor(cdp, `document.readyState === 'complete' && Boolean(document.querySelector('#homeView'))`);
}

async function run() {
  const browserPath = findBrowser();
  if (!browserPath) {
    process.stdout.write([
      'demo-gate:',
      '  status: skipped',
      `  reason: ${quoted('no Chrome or Playwright Chromium executable found')}`,
    ].join('\n') + '\n');
    return;
  }

  const problems = [];
  const steps = [];
  const requests = [];
  const appServer = createAppServer();
  const address = await listen(appServer, 0, '127.0.0.1');
  const debugPort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'demo-gate-'));
  const url = `http://127.0.0.1:${address.port}`;

  const browser = spawn(browserPath, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1100',
    url,
  ], { stdio: 'ignore' });

  let cdp;
  let failure = null;
  try {
    const page = await waitForPage(debugPort);
    cdp = connectCdp(page.webSocketDebuggerUrl, problems, requests);
    await cdp.ready;
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');
    await cdp.call('Log.enable');
    await cdp.call('Network.enable');

    const step = async (id, action) => { await action(); steps.push(id); };

    // ---- the exact sequence a judge watches -------------------------------
    await step('cold-start', async () => {
      await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#homeView')?.classList.contains('is-visible')`);
    });

    await step('open-practice', async () => {
      await evaluate(cdp, `document.querySelector('[data-start-practice]').click()`);
      await waitFor(cdp, `document.querySelector('#practiceSetup')?.classList.contains('is-visible')`);
    });

    await step('begin-attempt', async () => {
      await evaluate(cdp, `document.querySelector('#beginAttempt').click()`);
      await waitFor(cdp, `document.querySelector('#practiceAttempt')?.classList.contains('is-visible')`);
    });

    await step('analyse', async () => {
      await evaluate(cdp, `document.querySelector('#analyzeAttempt').click()`);
      await waitFor(cdp, `document.querySelector('#practiceReview')?.classList.contains('is-visible')`);
    });

    // Every visible verdict must carry evidence. A blank card on stage reads as broken.
    await step('every-verdict-has-evidence', async () => {
      const empty = await evaluate(cdp, `(() => {
        const cards = [...document.querySelectorAll('#reviewCriteria .evidence-item')];
        return cards.filter((card) => card.textContent.trim().length < 20).length;
      })()`);
      assert.equal(empty, 0, 'a criterion card rendered with no readable evidence');
    });

    await step('defend', async () => {
      await evaluate(cdp, `document.querySelector('#openDefense').click()`);
      await waitFor(cdp, `document.querySelector('#practiceDefense')?.classList.contains('is-visible')`);
      await evaluate(cdp, `(() => {
        const answer = document.querySelector('#defenseAnswer');
        answer.value = 'Unlike generic competitors, we keep every critique traceable to the active rubric and transcript with unique logic.';
        answer.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#evaluateDefense').click();
      })()`);
      await waitFor(cdp, `document.querySelector('#defenseResult')?.hidden === false`);
    });

    await step('save-session', async () => {
      await evaluate(cdp, `document.querySelector('#saveSession').click()`);
      await waitFor(cdp, `document.querySelector('#progressView')?.classList.contains('is-visible')`);
    });

    // ---- adversarial: the laptop lid closes, someone hits refresh ---------
    await step('survives-reload', async () => {
      const before = await evaluate(cdp, `JSON.parse(localStorage.getItem('talkactive.workspace.v1')).sessions.length`);
      await reload(cdp);
      const after = await evaluate(cdp, `JSON.parse(localStorage.getItem('talkactive.workspace.v1')).sessions.length`);
      assert.equal(after, before, 'saved sessions did not survive a reload');
    });

    // ---- adversarial: the venue wifi dies at the booth --------------------
    // A plain static site cannot survive an offline *reload* without a service
    // worker, so we do not pretend to test that. The real booth risk is an
    // external resource (CDN font, analytics, model API) that hangs when venue
    // wifi drops and freezes the demo. The fix is to depend on nothing remote.
    await step('no-external-dependencies', async () => {
      const external = requests.filter((request) => !request.startsWith(url)
        && !request.startsWith('data:')
        && !request.startsWith('blob:'));
      assert.deepEqual(
        external, [],
        'the demo loaded a resource from outside its own origin. At the booth a '
        + 'dropped connection would stall it. Vendor it locally instead.',
      );
    });

  } catch (error) {
    failure = error;
  } finally {
    cdp?.close();
    browser.kill('SIGTERM');
    await close(appServer);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // Chrome logs a benign favicon 404 for a page that declares no icon; that is
  // not a product defect and must not block a demo.
  const real = problems.filter((problem) => !/favicon/iu.test(problem.detail ?? ''));

  const lines = ['demo-gate:'];
  lines.push(`  status: ${failure || real.length ? 'failed' : 'passed'}`);
  lines.push(`steps[${steps.length}]{id,status}:`);
  for (const id of steps) lines.push(`  ${id},passed`);
  if (failure) lines.push(`  ${quoted(failure.message)},failed`);
  lines.push(`console[${real.length}]{kind,detail}:`);
  for (const problem of real) lines.push(`  ${problem.kind},${quoted(problem.detail)}`);
  process.stdout.write(lines.join('\n') + '\n');

  if (failure) throw failure;
  assert.equal(
    real.length, 0,
    'the demo path produced console errors; judges score "no critical bugs during the live demo"',
  );
}

run().catch((error) => {
  process.stderr.write(`demo-gate failed: ${error.message}\n`);
  process.exitCode = 1;
});
