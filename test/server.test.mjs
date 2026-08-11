import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../scripts/serve.mjs';
import { browserCandidates, findBrowser } from '../scripts/browser-paths.mjs';

test('static server exposes the product workspace but not research documents', async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.equal(typeof address, 'object');
  const origin = `http://127.0.0.1:${address.port}`;

  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Rehearsal workspace/u);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/u);

  const brief = await fetch(`${origin}/brief.html?from=judge`);
  assert.equal(brief.status, 200);
  assert.match(brief.headers.get('content-type'), /text\/html/u);
  assert.match(await brief.text(), /Practise the claims judges will score/u);

  const booth = await fetch(`${origin}/booth.html?from=exhibition`);
  assert.equal(booth.status, 200);
  assert.match(booth.headers.get('content-type'), /text\/html/u);
  assert.match(await booth.text(), /Bring the rubric/u);

  const briefHead = await fetch(`${origin}/brief.html`, { method: 'HEAD' });
  assert.equal(briefHead.status, 200);
  assert.match(briefHead.headers.get('content-security-policy'), /default-src 'self'/u);
  assert.equal(await briefHead.text(), '');

  const analyzer = await fetch(`${origin}/src/analyzer.mjs`);
  assert.equal(analyzer.status, 200);
  assert.match(analyzer.headers.get('content-type'), /text\/javascript/u);

  const windowsStyleAnalyzer = await fetch(`${origin}/src%5Canalyzer.mjs`);
  assert.equal(windowsStyleAnalyzer.status, 200);
  assert.match(windowsStyleAnalyzer.headers.get('content-type'), /text\/javascript/u);

  const encodedTraversal = await fetch(`${origin}/src%5C..%5C..%5C.env.example`);
  assert.equal(encodedTraversal.status, 404);

  const rubricImport = await fetch(`${origin}/api/import-rubric`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(rubricImport.status, 400);
  assert.deepEqual(await rubricImport.json(), {
    error: 'empty_rubric',
    message: 'Paste the scoring matrix first.',
  });

  const mascot = await fetch(`${origin}/src/assets/macaw-mark.svg`);
  assert.equal(mascot.status, 200);
  assert.match(mascot.headers.get('content-type'), /image\/svg\+xml/u);

  const apparelMascot = await fetch(`${origin}/src/assets/macaw-mark-white.svg`);
  assert.equal(apparelMascot.status, 200);
  assert.match(apparelMascot.headers.get('content-type'), /image\/svg\+xml/u);

  const favicon = await fetch(`${origin}/src/assets/macaw-favicon.svg`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get('content-type'), /image\/svg\+xml/u);

  const characterMascot = await fetch(`${origin}/src/assets/cockatoo-mascot-3d.webp`);
  assert.equal(characterMascot.status, 200);
  assert.match(characterMascot.headers.get('content-type'), /image\/webp/u);

  const privateDocument = await fetch(`${origin}/docs/Guidebook%20Registration%20RISTEK%20Hackathon.pdf`);
  assert.equal(privateDocument.status, 404);

  const mutation = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(mutation.status, 405);
});

test('browser discovery covers Windows Chrome, Edge, and explicit overrides', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\student\\AppData\\Local',
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
  };
  const candidates = browserCandidates({ platform: 'win32', env });
  assert.ok(candidates.includes('C:\\Users\\student\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(candidates.includes('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'));

  const explicit = 'D:\\Portable\\chrome.exe';
  assert.equal(findBrowser({
    platform: 'win32',
    env: { ...env, CHROME_BIN: explicit },
    exists: (candidate) => candidate === explicit,
  }), explicit);
});
