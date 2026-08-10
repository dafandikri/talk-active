import test from 'node:test';
import assert from 'node:assert/strict';

import protectDeployment from '../middleware.js';

function authorization(password) {
  return `Basic ${Buffer.from(`talkactive:${password}`).toString('base64')}`;
}

test('deployment is public by default so visitors can try it (B1)', async () => {
  const previousMode = process.env.PRIVATE_DEPLOYMENT;
  delete process.env.PRIVATE_DEPLOYMENT;
  try {
    const result = await protectDeployment(new Request('https://talkactive.example/'));
    assert.equal(result, undefined, 'a visitor must reach the app with no credentials');
  } finally {
    if (previousMode === undefined) delete process.env.PRIVATE_DEPLOYMENT;
    else process.env.PRIVATE_DEPLOYMENT = previousMode;
  }
});

test('deployment middleware fails closed when privacy is requested without a password', async () => {
  const previous = process.env.SITE_PASSWORD;
  const previousMode = process.env.PRIVATE_DEPLOYMENT;
  process.env.PRIVATE_DEPLOYMENT = '1';
  delete process.env.SITE_PASSWORD;
  try {
    const response = await protectDeployment(new Request('https://talkactive.example/'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    if (previous === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = previous;
    if (previousMode === undefined) delete process.env.PRIVATE_DEPLOYMENT;
    else process.env.PRIVATE_DEPLOYMENT = previousMode;
  }
});

test('deployment middleware challenges missing or incorrect credentials', async () => {
  const previous = process.env.SITE_PASSWORD;
  const previousMode = process.env.PRIVATE_DEPLOYMENT;
  process.env.PRIVATE_DEPLOYMENT = '1';
  process.env.SITE_PASSWORD = 'correct-password';
  try {
    const response = await protectDeployment(new Request('https://talkactive.example/', {
      headers: { authorization: authorization('wrong-password') },
    }));
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /Talk-Active Internal/u);
    assert.match(response.headers.get('x-robots-tag'), /noindex/u);
  } finally {
    if (previous === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = previous;
    if (previousMode === undefined) delete process.env.PRIVATE_DEPLOYMENT;
    else process.env.PRIVATE_DEPLOYMENT = previousMode;
  }
});

test('deployment middleware allows the configured credentials', async () => {
  const previous = process.env.SITE_PASSWORD;
  const previousMode = process.env.PRIVATE_DEPLOYMENT;
  process.env.PRIVATE_DEPLOYMENT = '1';
  process.env.SITE_PASSWORD = 'correct-password';
  try {
    const result = await protectDeployment(new Request('https://talkactive.example/src/app.mjs', {
      headers: { authorization: authorization('correct-password') },
    }));
    assert.equal(result, undefined);
  } finally {
    if (previous === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = previous;
    if (previousMode === undefined) delete process.env.PRIVATE_DEPLOYMENT;
    else process.env.PRIVATE_DEPLOYMENT = previousMode;
  }
});
