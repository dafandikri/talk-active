import test from 'node:test';
import assert from 'node:assert/strict';

import protectDeployment from '../middleware.mjs';

function authorization(password) {
  return `Basic ${Buffer.from(`lancar:${password}`).toString('base64')}`;
}

test('deployment middleware fails closed when no private password is configured', async () => {
  const previous = process.env.SITE_PASSWORD;
  delete process.env.SITE_PASSWORD;
  try {
    const response = await protectDeployment(new Request('https://lancar.example/'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    if (previous === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = previous;
  }
});

test('deployment middleware challenges missing or incorrect credentials', async () => {
  const previous = process.env.SITE_PASSWORD;
  process.env.SITE_PASSWORD = 'correct-password';
  try {
    const response = await protectDeployment(new Request('https://lancar.example/', {
      headers: { authorization: authorization('wrong-password') },
    }));
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /Lancar Internal/u);
    assert.match(response.headers.get('x-robots-tag'), /noindex/u);
  } finally {
    if (previous === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = previous;
  }
});

test('deployment middleware allows the configured credentials', async () => {
  const previous = process.env.SITE_PASSWORD;
  process.env.SITE_PASSWORD = 'correct-password';
  try {
    const result = await protectDeployment(new Request('https://lancar.example/src/app.mjs', {
      headers: { authorization: authorization('correct-password') },
    }));
    assert.equal(result, undefined);
  } finally {
    if (previous === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = previous;
  }
});
