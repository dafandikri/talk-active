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

  const privateDocument = await fetch(`${origin}/docs/Guidebook%20Registration%20RISTEK%20Hackathon.pdf`);
  assert.equal(privateDocument.status, 404);

  const mutation = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(mutation.status, 405);
});
