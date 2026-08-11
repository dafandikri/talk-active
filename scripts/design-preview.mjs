#!/usr/bin/env node
// ============================================================================
//  Render the design system to a set of screenshots: app, booth, and apparel.
//
//    pnpm design:preview                 # writes to docs/design/preview/
//    pnpm design:preview --out /tmp/x    # somewhere else
//
//  Two jobs:
//    1. Let a human LOOK at the system. Two contrast bugs shipped past a green
//       test suite and were caught by looking at a screenshot, so looking is
//       part of the gate now, not a nicety.
//    2. Give the team a reference render of every component in every state,
//       plus the production apparel lockup.
//
//  Reuses the browser plumbing from browser-check.mjs so there is one way to
//  drive Chrome in this repo, not two.
// ============================================================================
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { findBrowser } from './browser-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function outputDirectory(argv) {
  const index = argv.indexOf('--out');
  if (index !== -1 && argv[index + 1]) return resolvePath(argv[index + 1]);
  return join(ROOT, 'docs', 'design', 'preview');
}

// --- minimal CDP client (same shape as browser-check.mjs) -------------------
async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  await new Promise((ok, fail) => {
    socket.addEventListener('open', ok, { once: true });
    socket.addEventListener('error', () => fail(new Error('could not connect to browser')), { once: true });
  });
  return {
    call(method, params = {}) {
      const id = sequence += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
  }
  return result.result.value;
}

async function shoot(cdp, path, { fullPage = true } = {}) {
  const capture = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: fullPage,
  });
  writeFileSync(path, Buffer.from(capture.data, 'base64'));
  return path;
}

// --- the preview document ---------------------------------------------------
// Rendered against the real tokens.css and styles.css, so it cannot drift from
// what ships. If a component looks wrong here, it is wrong in the product.
//
// No <style> block and no style="" attributes: the server sends the same
// `style-src 'self'` CSP as production, which blocks both. The preview lives
// under the same rules as the app rather than relaxing them.
const PREVIEW_CSS = `
.spec { max-width: 1000px; margin: 0 auto; display: grid; gap: var(--space-7); padding: var(--space-7) var(--space-5); }
.spec section { display: block; }
.spec h2 { margin-bottom: var(--space-4); color: var(--text-primary); }
.row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: var(--space-3); }
.sw { padding: var(--space-5) var(--space-4); border-radius: var(--radius-md); border: 1px solid var(--border); font-size: var(--step-0); font-weight: var(--weight-heavy); }
.sw code { display: block; margin-top: var(--space-2); font-weight: var(--weight-regular); opacity: .8; }
.sw-brand    { background: var(--brand);          color: var(--brand-contrast); }
.sw-wash     { background: var(--brand-wash);     color: var(--brand); }
.sw-evidence { background: var(--evidence);       color: var(--surface); }
.sw-evwash   { background: var(--evidence-wash);  color: var(--evidence-strong); }
.sw-absence  { background: var(--absence-wash);   color: var(--absence); }
.sw-inverse  { background: var(--surface-inverse); color: var(--text-on-inverse); }
.sw-raised   { background: var(--inverse-raised); color: var(--text-on-inverse); }
.sw-danger   { background: var(--danger-wash);    color: var(--danger); }
.scale-row { display: flex; align-items: baseline; gap: var(--space-5); padding: var(--space-3) 0; border-bottom: 1px solid var(--border); color: var(--text-primary); }
.scale-row code { flex: 0 0 auto; min-width: 16ch; color: var(--text-muted); font-size: var(--step-0); }
.t0 { font-size: var(--step-0); } .t1 { font-size: var(--step-1); } .t2 { font-size: var(--step-2); }
.t3 { font-size: var(--step-3); } .t4 { font-size: var(--step-4); } .t5 { font-size: var(--step-5); }
.t6 { font-size: var(--step-6); }
.tev { font-size: var(--step-evidence); font-family: var(--font-voice); }
.apparel-spec { min-height: 100vh; padding: var(--space-7); background: var(--canvas); color: var(--text-primary); }
.apparel-heading { max-width: 760px; margin: 0 auto var(--space-7); text-align: center; }
.apparel-heading h1 { margin: var(--space-2) 0 var(--space-3); }
.apparel-stage { display: grid; grid-template-columns: repeat(2, minmax(0, 420px)); justify-content: center; gap: var(--space-7); }
.shirt-view { text-align: center; }
.shirt-view > p { margin-top: var(--space-3); color: var(--text-muted); font-size: var(--step-0); font-weight: var(--weight-bold); letter-spacing: var(--tracking-wide); text-transform: uppercase; }
.shirt { position: relative; width: 100%; aspect-ratio: 4 / 5; overflow: hidden; color: var(--text-on-inverse); background: var(--accent-sky); clip-path: polygon(22% 0, 37% 0, 42% 8%, 58% 8%, 63% 0, 78% 0, 100% 14%, 88% 35%, 79% 29%, 79% 100%, 21% 100%, 21% 29%, 12% 35%, 0 14%); }
.shirt::before { position: absolute; top: -1%; left: 42%; width: 16%; height: 11%; border-radius: 0 0 var(--radius-full) var(--radius-full); background: var(--canvas); content: ""; }
.shirt-lockup { position: absolute; top: 22%; left: 28%; display: flex; align-items: center; gap: var(--space-2); color: var(--text-on-inverse); font-size: var(--step-1); font-weight: var(--weight-heavy); letter-spacing: var(--tracking-tight); }
.shirt-lockup img { width: 46px; height: 46px; }
.shirt-back-art { position: absolute; inset: 18% 23% auto; text-align: left; }
.shirt-back-art img { width: 78px; height: 78px; margin-bottom: var(--space-4); }
.shirt-back-art strong { display: block; max-width: 10ch; font-size: var(--step-4); line-height: var(--leading-tight); letter-spacing: var(--tracking-tight); }
.shirt-back-art span { display: block; margin-top: var(--space-5); padding-top: var(--space-3); border-top: 2px solid currentColor; font-size: var(--step-0); font-weight: var(--weight-bold); letter-spacing: var(--tracking-wide); line-height: var(--leading-normal); text-transform: uppercase; }
.apparel-notes { display: flex; justify-content: center; gap: var(--space-3); margin-top: var(--space-6); }
.apparel-note { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-full); background: var(--surface); font-size: var(--step-0); color: var(--text-secondary); }
.apparel-swatch { width: 18px; height: 18px; border: 2px solid var(--surface); border-radius: var(--radius-full); background: var(--accent-sky); }
.apparel-swatch.leaf { background: var(--accent-leaf); }
`;

function apparelHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Talk-Active design system — apparel</title>
<link rel="stylesheet" href="/src/tokens.css">
<link rel="stylesheet" href="/src/styles.css">
<link rel="stylesheet" href="/src/_preview.css">
</head>
<body>
<main class="apparel-spec">
  <header class="apparel-heading">
    <p class="overline">Talk-Active team apparel</p>
    <h1>One bird. One ink. Recognizable across the room.</h1>
    <p class="page-lede">The shirt carries the colour; the speaking-bird mark and typography print in warm white.</p>
  </header>
  <div class="apparel-stage">
    <article class="shirt-view">
      <div class="shirt">
        <div class="shirt-lockup"><img src="/src/assets/macaw-mark-white.svg" alt=""><span>Talk-Active</span></div>
      </div>
      <p>Front · compact left-chest lockup</p>
    </article>
    <article class="shirt-view">
      <div class="shirt">
        <div class="shirt-back-art">
          <img src="/src/assets/macaw-mark-white.svg" alt="">
          <strong>Practice the answer before the question.</strong>
          <span>Project → rubric → attempt → evidence → defend</span>
        </div>
      </div>
      <p>Back · product promise and rehearsal loop</p>
    </article>
  </div>
  <div class="apparel-notes">
    <span class="apparel-note"><i class="apparel-swatch"></i>Primary · Sky blue #1B7EA6</span>
    <span class="apparel-note"><i class="apparel-swatch leaf"></i>Approved alternate · Deep leaf #2F5923</span>
    <span class="apparel-note">One warm-white ink · #FFFEF9</span>
  </div>
</main>
</body>
</html>`;
}

function previewHtml(surface) {
  if (surface === 'apparel') return apparelHtml();
  const booth = surface === 'booth';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Talk-Active design system — ${surface}</title>
<link rel="stylesheet" href="/src/tokens.css">
<link rel="stylesheet" href="/src/styles.css">
<link rel="stylesheet" href="/src/_preview.css">
</head>
<body${booth ? ' data-surface="booth"' : ''}>
<div class="spec">

  <header>
    <p class="overline">Talk-Active design system</p>
    <h1>${booth ? 'Booth surface' : 'Application surface'}</h1>
    <p class="page-lede">Rendered against the shipped tokens.css and styles.css. If it looks wrong here, it is wrong in the product.</p>
  </header>

  <section>
    <h2>The citation card</h2>
    <div class="evidence-list">
      <article class="evidence-item" data-evidence="found">
        <div class="evidence-topline">
          <strong>Problem clarity</strong>
          <span class="evidence-state">evidence found</span>
        </div>
        <blockquote class="evidence-quote">Students rehearse alone and get no feedback on whether their answer actually met the rubric</blockquote>
        <p class="evidence-source">your words, from this attempt</p>
      </article>
      <article class="evidence-item" data-evidence="absent">
        <div class="evidence-topline">
          <strong>Feasibility</strong>
          <span class="evidence-state">no cue matched</span>
        </div>
        <p class="evidence-absent">Nothing in this attempt matched the cues for this criterion.<span> Looked for: timeline, cost, team capacity, prior build.</span></p>
      </article>
    </div>
  </section>

  <section>
    <h2>Cue chips</h2>
    <div class="row">
      <span class="signal-chip matched">tested</span>
      <span class="signal-chip matched">median</span>
      <span class="signal-chip">timeline</span>
      <span class="signal-chip">cost</span>
      <span class="signal-chip neutral">no declared cues missing</span>
    </div>
  </section>

  <section>
    <h2>Actions</h2>
    <div class="row">
      <button class="button button-primary">Analyse this attempt</button>
      <button class="button button-secondary">Exit session</button>
      <button class="button button-primary" disabled>Disabled</button>
      <button class="text-button">Edit criteria <span>&rarr;</span></button>
    </div>
  </section>

  <section>
    <h2>Type scale</h2>
    <div class="scale-row"><code>--step-6 / 46</code><span class="t6">Booth headline</span></div>
    <div class="scale-row"><code>--step-5 / 37</code><span class="t5">Hero</span></div>
    <div class="scale-row"><code>--step-evidence</code><span class="tev">The quoted span</span></div>
    <div class="scale-row"><code>--step-4 / 29</code><span class="t4">Page title</span></div>
    <div class="scale-row"><code>--step-3 / 23</code><span class="t3">Section head</span></div>
    <div class="scale-row"><code>--step-2 / 19</code><span class="t2">Card title</span></div>
    <div class="scale-row"><code>--step-1 / 15</code><span class="t1">Body copy</span></div>
    <div class="scale-row"><code>--step-0 / 12</code><span class="t0">Overline and meta</span></div>
  </section>

  <section>
    <h2>Semantic colour</h2>
    <div class="swatches">
      <div class="sw sw-brand">Brand<code>--brand</code></div>
      <div class="sw sw-wash">Brand wash<code>--brand-wash</code></div>
      <div class="sw sw-evidence">EVIDENCE<code>--evidence</code></div>
      <div class="sw sw-evwash">Evidence wash<code>--evidence-wash</code></div>
      <div class="sw sw-absence">Absence<code>--absence</code></div>
      <div class="sw sw-inverse">Inverse<code>--surface-inverse</code></div>
      <div class="sw sw-raised">Inverse raised<code>--inverse-raised</code></div>
      <div class="sw sw-danger">Danger (system only)<code>--danger</code></div>
    </div>
  </section>

</div>
</body>
</html>`;
}

// --- run --------------------------------------------------------------------
async function main() {
  const outDir = outputDirectory(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });

  const browser = findBrowser();
  if (!browser) {
    process.stderr.write('No Chrome/Chromium found. Set CHROME_PATH.\n');
    process.exit(2);
  }

  // Serve from the repo root so the preview loads the REAL stylesheets.
  const server = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TALK_ACTIVE_PORT: '4199' },
  });
  const base = 'http://127.0.0.1:4199';
  await delay(700);

  const written = [];
  const temporary = [];
  const profile = join(ROOT, '.design-preview-profile');

  const chrome = spawn(browser, [
    '--headless=new', '--remote-debugging-port=9333', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    await delay(1200);
    const list = await fetch('http://127.0.0.1:9333/json/list').then((r) => r.json());
    const target = list.find((t) => t.type === 'page');
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');

    for (const surface of ['app', 'booth', 'apparel']) {
      // The preview must be served, not loaded from file://, or the CSP and the
      // stylesheet paths do not match what ships.
      const cssFile = join(ROOT, 'src', '_preview.css');
      writeFileSync(cssFile, PREVIEW_CSS);
      temporary.push(cssFile);
      const file = join(ROOT, 'src', `_preview-${surface}.html`);
      writeFileSync(file, previewHtml(surface));
      temporary.push(file);

      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width: 1200, height: 900, deviceScaleFactor: 2, mobile: false,
      });
      await evaluate(cdp, `location.href = ${JSON.stringify(`${base}/src/_preview-${surface}.html`)}`);
      await delay(900);

      const path = join(outDir, `${surface}.png`);
      await shoot(cdp, path);
      written.push(path);
    }

    cdp.close();
  } finally {
    const chromeStopped = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    server.kill();
    await Promise.race([chromeStopped, delay(1000)]);
    for (const file of temporary) rmSync(file, { force: true });
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }

  process.stdout.write(`design-preview:\n  status: ok\n`);
  for (const path of written) process.stdout.write(`  wrote ${path}\n`);
}

main().catch((error) => {
  process.stderr.write(`design-preview failed: ${error.message}\n`);
  process.exit(1);
});
