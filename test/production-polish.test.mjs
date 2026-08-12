import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SITE = 'https://talk-active-id.vercel.app';

test('F-8 public pages ship complete same-origin social and canonical metadata', async () => {
  const pages = [
    ['index.html', `${SITE}/`],
    ['brief.html', `${SITE}/brief.html`],
  ];
  for (const [path, canonical] of pages) {
    const html = await readFile(path, 'utf8');
    for (const property of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) {
      assert.match(html, new RegExp(`<meta property="${property}" content="[^"]+">`, 'u'));
    }
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/u);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical.replaceAll('.', '\\.')}">`, 'u'));
    assert.match(html, new RegExp(`<meta property="og:image" content="${SITE.replaceAll('.', '\\.')}\/`, 'u'));
  }
});

test('F-8 static and Next runtimes both expose robots and branded not-found surfaces', async () => {
  const [notFound, robots, layout, nextNotFound, nextRobots] = await Promise.all([
    readFile('404.html', 'utf8'),
    readFile('robots.txt', 'utf8'),
    readFile('apps/web/app/layout.tsx', 'utf8'),
    readFile('apps/web/app/not-found.tsx', 'utf8'),
    readFile('apps/web/app/robots.ts', 'utf8'),
  ]);
  assert.match(notFound, /name="robots" content="noindex"/u);
  assert.match(notFound, /This route is not part of the rehearsal workspace/u);
  assert.doesNotMatch(notFound, /https?:\/\/[^"']+/u, '404 resources must stay on the same origin');
  assert.match(robots, /^User-agent: \*\nAllow: \/\n$/u);
  assert.match(layout, /metadataBase: new URL\('https:\/\/talk-active-id\.vercel\.app'\)/u);
  assert.match(layout, /openGraph:/u);
  assert.match(layout, /twitter:/u);
  assert.match(nextNotFound, /This route is not part of the rehearsal workspace/u);
  assert.match(nextRobots, /userAgent: '\*', allow: '\/'/u);
});
