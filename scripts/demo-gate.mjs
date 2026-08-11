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

import { analyze as analyzeRequest } from '../api/analyze.mjs';
import { findBrowser } from './browser-paths.mjs';
import { createServer as createAppServer } from './serve.mjs';

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
  // A *.localhost name still resolves to loopback, but exercises the same
  // client path as deployment instead of the explicit 127.0.0.1 offline path.
  const url = `http://talk-active.localhost:${address.port}`;

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

    // ---- cost + replay: semantic hits cache, degraded responses never do --
    await step('semantic-cache', async () => {
      const semanticInput = {
        transcript: 'Cache proof transcript unique to the canonical demo gate.',
        rubricText: 'Cache behavior | repeat, instant',
        durationSeconds: 30,
      };
      let semanticCalls = 0;
      const semanticStub = async () => {
        semanticCalls += 1;
        return { mode: 'semantic', evidenceScore: 100 };
      };
      const first = await analyzeRequest(semanticInput, semanticStub);
      const replayStartedAt = performance.now();
      const replay = await analyzeRequest(semanticInput, semanticStub);
      const replayElapsed = performance.now() - replayStartedAt;

      assert.equal(first.cached, false, 'first semantic response was incorrectly labelled as cached');
      assert.equal(replay.cached, true, 'identical semantic response missed the server cache');
      assert.equal(semanticCalls, 1, 'identical semantic request called the model twice');
      assert.ok(replayElapsed < 100, `cached semantic replay took ${replayElapsed}ms; A5 requires under 100ms`);

      const degradedInput = {
        ...semanticInput,
        transcript: 'Degraded cache proof transcript unique to the canonical demo gate.',
      };
      let degradedCalls = 0;
      const degradedStub = async () => {
        degradedCalls += 1;
        return { mode: 'deterministic', evidenceScore: 50 };
      };
      const degradedFirst = await analyzeRequest(degradedInput, degradedStub);
      const degradedSecond = await analyzeRequest(degradedInput, degradedStub);
      assert.equal(degradedFirst.cached, false);
      assert.equal(degradedSecond.cached, false, 'a degraded response was pinned in the server cache');
      assert.equal(degradedCalls, 2, 'a degraded response prevented a later semantic retry');
    });

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
      await evaluate(cdp, `(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (resource, options) => {
          if (resource === '/api/analyze') {
            const criteria = [
              { id: 'problem-clarity', label: 'Problem clarity', score: 100, status: 'covered', excerpt: 'Talk-Active lets a student use the actual evaluation rubric while practicing a pitch.', missingSignals: [], signals: ['students'] },
              { id: 'solution-fit', label: 'Solution fit', score: 100, status: 'covered', excerpt: 'The product maps rubric criteria to the exact sentence in the transcript that supports them.', missingSignals: [], signals: ['rubric'] },
              { id: 'differentiation', label: 'Differentiation', score: 0, status: 'missing', excerpt: '', missingSignals: ['unique product logic'], signals: ['unique'] },
              { id: 'feasibility-and-trust', label: 'Feasibility and trust', score: 0, status: 'missing', excerpt: '', missingSignals: ['privacy boundary'], signals: ['privacy'] }
            ];
            return new Response(JSON.stringify({
              mode: 'semantic', evidenceScore: 50, coveredCount: 2, criterionCount: 4,
              criteria, weakest: criteria[2],
              judgeQuestion: 'What unique product logic makes this defensible?',
              drill: 'State the unique product logic directly.',
              delivery: { wordCount: 180, durationSeconds: 90, wordsPerMinute: 120, pace: 'steady', fillerCount: 0, fillers: [] }
            }), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          return nativeFetch(resource, options);
        };
      })()`);
      await evaluate(cdp, `document.querySelector('#analyzeAttempt').click()`);
      await waitFor(cdp, `document.querySelector('#practiceReview')?.classList.contains('is-visible')`);
    });

    await step('semantic-mode', async () => {
      const semantic = await evaluate(cdp, `(() => ({
        mode: document.querySelector('#reviewMode')?.textContent,
        cards: document.querySelectorAll('#reviewCriteria .evidence-item').length
      }))()`);
      assert.match(semantic.mode, /language model/iu);
      assert.equal(semantic.cards, 4, 'semantic mode did not render every verdict');
    });

    // ---- adversarial: the model API dies after the semantic pass ----------
    await step('fallback-mode', async () => {
      await evaluate(cdp, `(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (resource, options) => {
          if (resource === '/api/analyze') {
            return new Response(JSON.stringify({ error: 'analysis_failed' }), {
              status: 500, headers: { 'content-type': 'application/json' }
            });
          }
          return nativeFetch(resource, options);
        };
        document.querySelector('#reviseAttempt').click();
      })()`);
      await waitFor(cdp, `document.querySelector('#practiceAttempt')?.classList.contains('is-visible')`);
      await evaluate(cdp, `document.querySelector('#analyzeAttempt').click()`);
      await waitFor(cdp, `document.querySelector('#practiceReview')?.classList.contains('is-visible')`);
      const fallback = await evaluate(cdp, `(() => ({
        mode: document.querySelector('#reviewMode')?.textContent,
        cards: document.querySelectorAll('#reviewCriteria .evidence-item').length
      }))()`);
      assert.doesNotMatch(fallback.mode, /language model/iu);
      assert.match(fallback.mode, /cue matching/iu);
      assert.equal(fallback.cards, 4, 'fallback did not render every verdict');
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

    // ---- adversarial: rubric structuring fails, manual editing survives ---
    await step('import-failure', async () => {
      await evaluate(cdp, `document.querySelector('[data-route="rubric"]').click()`);
      await waitFor(cdp, `document.querySelector('#rubricView')?.classList.contains('is-visible')`);
      await evaluate(cdp, `(() => {
        const source = 'Technical Execution 30%\\nPitching and Q&A 20%';
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (resource, options) => {
          if (resource === '/api/import-rubric') {
            return new Response(JSON.stringify({
              error: 'import_unavailable',
              message: 'Import unavailable — edit the criteria manually instead.'
            }), { status: 422, headers: { 'content-type': 'application/json' } });
          }
          return nativeFetch(resource, options);
        };
        document.querySelector('#rubricImport').open = true;
        document.querySelector('#rubricImportInput').value = source;
        document.querySelector('#rubricImportButton').click();
      })()`);
      await waitFor(cdp, `document.querySelector('#rubricImportStatus')?.textContent.includes('manually')`);
      const importFallback = await evaluate(cdp, `(() => ({
        source: document.querySelector('#rubricImportInput')?.value,
        rows: document.querySelectorAll('#rubricEditor .rubric-row').length,
        addDisabled: document.querySelector('#addCriterion')?.disabled
      }))()`);
      assert.match(importFallback.source, /Technical Execution 30%/u, 'failed import lost the pasted matrix');
      assert.ok(importFallback.rows > 0, 'failed import left no manual criteria to edit');
      assert.equal(importFallback.addDisabled, false, 'failed import disabled manual editing');
    });

    // ---- kiosk handoff: one control restores a clean, rehearsed workspace --
    await step('kiosk-reset', async () => {
      const reset = await evaluate(cdp, `(() => {
        localStorage.setItem('talkactive.dictation.language', 'en-US');
        document.querySelector('[data-reset-workspace]').click();
        return {
          open: document.querySelector('#resetDialog')?.open,
          focused: document.activeElement?.id
        };
      })()`);
      assert.equal(reset.open, true, 'reset confirmation did not open');
      assert.equal(reset.focused, 'cancelReset', 'reset dialog did not focus the safe action');

      await evaluate(cdp, `(() => {
        window.__kioskResetStartedAt = performance.now();
        document.querySelector('#confirmReset').click();
      })()`);
      await waitFor(cdp, `location.hash === '#home' && document.querySelector('#resetDialog')?.open === false`);

      const restored = await evaluate(cdp, `(() => {
        const workspace = JSON.parse(localStorage.getItem('talkactive.workspace.v1'));
        return {
          elapsed: performance.now() - window.__kioskResetStartedAt,
          projectIds: workspace.projects.map((project) => project.id),
          sessionIds: workspace.sessions.map((session) => session.id),
          activeProjectId: workspace.activeProjectId,
          draftLength: workspace.projects[0]?.draft?.length ?? 0,
          language: localStorage.getItem('talkactive.dictation.language'),
          toast: document.querySelector('#toastCopy')?.textContent
        };
      })()`);
      assert.ok(restored.elapsed < 1000, `kiosk reset took ${restored.elapsed}ms; the requirement is under 1000ms`);
      assert.deepEqual(restored.projectIds, ['project-talk-active'], 'reset did not restore the seed project');
      assert.deepEqual(restored.sessionIds, ['session-1', 'session-2'], 'reset did not restore the seed sessions');
      assert.equal(restored.activeProjectId, 'project-talk-active', 'reset restored the wrong active project');
      assert.ok(restored.draftLength > 200, 'reset did not restore the seed pitch draft');
      assert.equal(restored.language, 'en-US', 'reset erased the device dictation preference');
      assert.match(restored.toast, /workspace reset/iu, 'reset did not confirm completion');
    });

    await step('reset-survives-reload', async () => {
      await reload(cdp);
      const restored = await evaluate(cdp, `(() => {
        const workspace = JSON.parse(localStorage.getItem('talkactive.workspace.v1'));
        return {
          projects: workspace.projects.length,
          sessions: workspace.sessions.length,
          activeProjectId: workspace.activeProjectId,
          language: localStorage.getItem('talkactive.dictation.language')
        };
      })()`);
      assert.deepEqual(restored, {
        projects: 1,
        sessions: 2,
        activeProjectId: 'project-talk-active',
        language: 'en-US',
      }, 'the restored kiosk workspace did not survive reload');
    });

    // ---- visitors: complete the same judge loop on a 390px phone ----------
    await step('mobile-full-judge-path', async () => {
      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
      });

      const assertMobileStage = async (selector, label) => {
        const layout = await evaluate(cdp, `(() => {
          const stage = document.querySelector(${quoted(selector)});
          const controls = [...stage.querySelectorAll('button, input, select, textarea, a')]
            .filter((control) => control.getClientRects().length > 0)
            .filter((control) => {
              const rect = control.getBoundingClientRect();
              return rect.left < -0.5 || rect.right > window.innerWidth + 0.5;
            })
            .map((control) => control.id || control.textContent.trim().slice(0, 30));
          const undersized = [...stage.querySelectorAll('button, select, a')]
            .filter((control) => control.getClientRects().length > 0)
            .map((control) => {
              const rect = control.getBoundingClientRect();
              return {
                label: control.id || control.textContent.trim().slice(0, 30),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              };
            })
            .filter((control) => control.width < 44 || control.height < 44);
          return {
            visible: stage.classList.contains('is-visible'),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            controls,
            undersized
          };
        })()`);
        assert.equal(layout.visible, true, `${label} was not visible at 390px`);
        assert.equal(layout.overflow, 0, `${label} overflowed the 390px viewport`);
        assert.deepEqual(layout.controls, [], `${label} clipped controls horizontally`);
        assert.deepEqual(layout.undersized, [], `${label} has controls below the 44px mobile target`);
      };

      await evaluate(cdp, `document.querySelector('[data-start-practice]').click()`);
      await waitFor(cdp, `document.querySelector('#practiceSetup')?.classList.contains('is-visible')`);
      await assertMobileStage('#practiceSetup', 'mobile setup');

      await evaluate(cdp, `document.querySelector('#beginAttempt').click()`);
      await waitFor(cdp, `document.querySelector('#practiceAttempt')?.classList.contains('is-visible')`);
      await assertMobileStage('#practiceAttempt', 'mobile attempt');

      await evaluate(cdp, `(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (resource, options) => {
          if (resource !== '/api/analyze') return nativeFetch(resource, options);
          return new Promise((resolve) => {
            window.__resolveMobileAnalysis = () => {
              const criteria = [
                { id: 'problem-clarity', label: 'Problem clarity', score: 100, status: 'covered', excerpt: 'Talk-Active lets a student use the actual evaluation rubric while practicing a pitch.', missingSignals: [], signals: ['students'] },
                { id: 'solution-fit', label: 'Solution fit', score: 100, status: 'covered', excerpt: 'The product maps rubric criteria to the exact sentence in the transcript that supports them.', missingSignals: [], signals: ['rubric'] },
                { id: 'differentiation', label: 'Differentiation', score: 0, status: 'missing', excerpt: '', missingSignals: ['unique product logic'], signals: ['unique'] },
                { id: 'feasibility-and-trust', label: 'Feasibility and trust', score: 0, status: 'missing', excerpt: '', missingSignals: ['privacy boundary'], signals: ['privacy'] }
              ];
              resolve(new Response(JSON.stringify({
                mode: 'semantic', evidenceScore: 50, coveredCount: 2, criterionCount: 4,
                criteria, weakest: criteria[2],
                judgeQuestion: 'What unique product logic makes this defensible?',
                drill: 'State the unique product logic directly.',
                delivery: { wordCount: 180, durationSeconds: 90, wordsPerMinute: 120, pace: 'steady', fillerCount: 0, fillers: [] }
              }), { status: 200, headers: { 'content-type': 'application/json' } }));
            };
          });
        };
        document.querySelector('#analyzeAttempt').click();
      })()`);
      await waitFor(cdp, `document.querySelector('#analyzeAttempt')?.getAttribute('aria-busy') === 'true'`);
      const loading = await evaluate(cdp, `(() => ({
        disabled: document.querySelector('#analyzeAttempt')?.disabled,
        label: document.querySelector('#analyzeLabel')?.textContent,
        spinner: getComputedStyle(document.querySelector('#analyzeSpinner')).display,
        stage: document.querySelector('#practiceAttempt')?.classList.contains('is-visible')
      }))()`);
      assert.equal(loading.disabled, true, 'slow analysis did not disable repeat submission');
      assert.match(loading.label, /Mapping evidence/iu, 'slow analysis did not explain its state');
      assert.notEqual(loading.spinner, 'none', 'slow analysis showed no progress indicator');
      assert.equal(loading.stage, true, 'slow analysis blanked the attempt panel');
      await assertMobileStage('#practiceAttempt', 'mobile loading state');

      await evaluate(cdp, `window.__resolveMobileAnalysis()`);
      await waitFor(cdp, `document.querySelector('#practiceReview')?.classList.contains('is-visible')`);
      await assertMobileStage('#practiceReview', 'mobile review');
      const settled = await evaluate(cdp, `(() => ({
        busy: document.querySelector('#analyzeAttempt')?.getAttribute('aria-busy'),
        label: document.querySelector('#analyzeLabel')?.textContent,
        cards: document.querySelectorAll('#reviewCriteria .evidence-item').length
      }))()`);
      assert.equal(settled.busy, 'false', 'analysis control stayed busy after completion');
      assert.match(settled.label, /Review this attempt/iu, 'analysis control did not restore its label');
      assert.equal(settled.cards, 4, 'mobile review lost criterion cards');

      await evaluate(cdp, `document.querySelector('#openDefense').click()`);
      await waitFor(cdp, `document.querySelector('#practiceDefense')?.classList.contains('is-visible')`);
      await evaluate(cdp, `(() => {
        const answer = document.querySelector('#defenseAnswer');
        answer.value = 'Unlike generic competitors, we keep every critique traceable to the active rubric and transcript with unique product logic.';
        answer.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#evaluateDefense').click();
      })()`);
      await waitFor(cdp, `document.querySelector('#defenseResult')?.hidden === false`);
      await assertMobileStage('#practiceDefense', 'mobile defense');

      await evaluate(cdp, `document.querySelector('#saveSession').click()`);
      await waitFor(cdp, `document.querySelector('#progressView')?.classList.contains('is-visible')`);
      const saved = await evaluate(cdp, `(() => ({
        sessions: JSON.parse(localStorage.getItem('talkactive.workspace.v1')).sessions.length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }))()`);
      assert.equal(saved.sessions, 3, 'mobile judge path did not save the session');
      assert.equal(saved.overflow, 0, 'mobile progress overflowed after save');
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
