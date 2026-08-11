import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../scripts/serve.mjs';

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

  const briefHead = await fetch(`${origin}/brief.html`, { method: 'HEAD' });
  assert.equal(briefHead.status, 200);
  assert.match(briefHead.headers.get('content-security-policy'), /default-src 'self'/u);
  assert.equal(await briefHead.text(), '');

  const analyzer = await fetch(`${origin}/src/analyzer.mjs`);
  assert.equal(analyzer.status, 200);
  assert.match(analyzer.headers.get('content-type'), /text\/javascript/u);

  const mascot = await fetch(`${origin}/src/assets/cockatoo-mark.svg`);
  assert.equal(mascot.status, 200);
  assert.match(mascot.headers.get('content-type'), /image\/svg\+xml/u);

  const apparelMascot = await fetch(`${origin}/src/assets/cockatoo-mark-white.svg`);
  assert.equal(apparelMascot.status, 200);
  assert.match(apparelMascot.headers.get('content-type'), /image\/svg\+xml/u);

  const characterMascot = await fetch(`${origin}/src/assets/cockatoo-mascot-3d.webp`);
  assert.equal(characterMascot.status, 200);
  assert.match(characterMascot.headers.get('content-type'), /image\/webp/u);

  const privateDocument = await fetch(`${origin}/docs/Guidebook%20Registration%20RISTEK%20Hackathon.pdf`);
  assert.equal(privateDocument.status, 404);

  const mutation = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(mutation.status, 405);
});

test('the allow-list holds on every platform, and traversal never escapes the root', async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // A URL path is always slash-separated, so it has to be normalised with POSIX
  // rules. Normalising with the platform's rules turns "/src/tokens.css" into
  // "src\tokens.css" on Windows, which misses the allow-list and 404s every
  // stylesheet, module, and asset — the product loads as unstyled, inert HTML.
  for (const path of ['/src/tokens.css', '/src/styles.css', '/src/app.mjs']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 200, `${path} must be served on every platform`);
  }

  // Backslashes are folded to slashes BEFORE normalising, never after. "%5C"
  // decodes to a literal backslash; folding it afterwards would hand the
  // allow-list a clean "src/../../package.json" that escapes the root. This
  // asserts the ordering, which the comment in serve.mjs alone cannot enforce.
  for (const path of ['/src/../package.json', '/src%5C..%5C..%5Cpackage.json', '/src/../../../Windows/win.ini']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, `${path} must never resolve outside the allow-list`);
  }
});
