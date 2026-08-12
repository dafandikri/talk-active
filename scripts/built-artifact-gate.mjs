#!/usr/bin/env node
// ============================================================================
//  Does the thing we actually publish still work?
//
//  Every other gate in this repo runs against the source tree, because
//  scripts/serve.mjs serves from the repository root. That is fast and it is
//  why the demo gate is usable — but it means a file can be imported by
//  src/app.mjs, work perfectly in every local check, and simply not exist in
//  production.
//
//  That happened on 12 August. src/analysis-progress.mjs was missing from
//  PUBLIC_RUNTIME_FILES, its import 404'd, app.mjs never finished evaluating,
//  and not one event listener was attached. The whole workspace was inert on
//  the live site while `pnpm check` reported green.
//
//  test/deployment-artifact.test.mjs now catches a missing file statically.
//  This catches the same class dynamically: build the real artifact, serve
//  only that, and prove the application boots and responds. A static check
//  can be out-argued; a page that does not boot cannot.
// ============================================================================
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildPublic } from './build-public.mjs';
import { findBrowser } from './browser-paths.mjs';
import { createServer } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function connect(url) {
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method) events.push(message);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('browser connection failed')), { once: true });
  });
  return {
    ready,
    events,
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

async function firstPage(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        const page = (await response.json()).find((target) => target.type === 'page');
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // The browser is still starting; the next attempt is authoritative.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('headless browser never exposed a page');
}

async function freePort() {
  const { createServer: createNetServer } = await import('node:net');
  const probe = createNetServer();
  const address = await listen(probe);
  const port = address.port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function stopBrowser(browser) {
  if (browser.exitCode !== null || browser.signalCode !== null) return;
  browser.kill('SIGTERM');
  if (await waitForExit(browser)) return;
  browser.kill('SIGKILL');
  await waitForExit(browser, 2_000);
}

async function run() {
  const browserPath = findBrowser();
  if (!browserPath) {
    process.stdout.write('built-artifact:\n  status: skipped\n  reason: "no Chrome available"\n');
    return;
  }

  const staging = mkdtempSync(join(ROOT, '.tmp-public-gate-'));
  const output = join(staging, 'public');
  const build = buildPublic({ root: ROOT, output });

  // Serve ONLY the build output. Anything app.mjs reaches for that was not
  // published 404s here exactly as it would on Vercel.
  const server = createServer(output);
  const address = await listen(server);
  const url = `http://127.0.0.1:${address.port}`;
  const debugPort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'built-gate-'));
  const browser = spawn(browserPath, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    cdp = connect((await firstPage(debugPort)).webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');
    await cdp.call('Network.enable');

    await cdp.call('Page.navigate', { url });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const evaluate = async (expression) => {
      const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    };

    // 1. Nothing the published pages ask for may be missing.
    const failed = cdp.events
      .filter((event) => event.method === 'Network.loadingFailed' || (event.method === 'Network.responseReceived' && event.params.response.status >= 400))
      .map((event) => event.params.response?.url ?? event.params.errorText ?? 'unknown');
    assert.deepEqual(failed, [], `the built artifact is missing resources it references: ${failed.join(', ')}`);

    // 2. The module graph has to finish evaluating. A failed static import
    //    aborts it silently, so the proof is that JS-rendered content exists.
    const booted = await evaluate(`document.querySelector('#rehearserName')?.textContent ?? ''`);
    assert.equal(booted, 'Guest', 'src/app.mjs never finished evaluating — an import probably 404s in the build');

    // 3. Listeners have to be attached, which only a real interaction proves.
    await evaluate(`document.querySelector('.sidebar [data-route="rubric"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const routed = await evaluate(`document.querySelector('.view.is-visible')?.id`);
    assert.equal(routed, 'rubricView', 'navigation did not respond — no event listener is attached in the built artifact');

    await evaluate(`document.querySelector('#sidebarAddProject').click()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const dialog = await evaluate(`document.querySelector('#projectDialog').open === true`);
    assert.equal(dialog, true, 'the create-project control did nothing in the built artifact');

    const consoleErrors = cdp.events
      .filter((event) => event.method === 'Runtime.exceptionThrown')
      .map((event) => event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
    assert.deepEqual(consoleErrors, [], `the built artifact threw: ${consoleErrors.join(' | ')}`);

    process.stdout.write([
      'built-artifact:',
      '  status: passed',
      `  engine: ${JSON.stringify(basename(browserPath))}`,
      `  files: ${build.files}`,
      'checks[4]{id,status}:',
      '  no-missing-resources,passed',
      '  module-graph-evaluates,passed',
      '  navigation-responds,passed',
      '  create-project-responds,passed',
    ].join('\n') + '\n');
  } finally {
    cdp?.close();
    await stopBrowser(browser);
    await new Promise((resolve) => server.close(resolve));
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

run().catch((error) => {
  process.stdout.write(`built-artifact:\n  status: failed\n  error: ${JSON.stringify(error.message)}\n`);
  process.exitCode = 1;
});
