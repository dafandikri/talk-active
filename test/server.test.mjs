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

  const analyzer = await fetch(`${origin}/src/analyzer.mjs`);
  assert.equal(analyzer.status, 200);
  assert.match(analyzer.headers.get('content-type'), /text\/javascript/u);

  const privateDocument = await fetch(`${origin}/docs/Guidebook%20Registration%20RISTEK%20Hackathon.pdf`);
  assert.equal(privateDocument.status, 404);

  const mutation = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(mutation.status, 405);
});
