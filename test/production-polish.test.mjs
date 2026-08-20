import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SITE = 'https://talk-active-id.vercel.app';

// The two static HTML pages went with the vanilla build. Next declares the same
// metadata from the root layout and per-route `alternates.canonical`, so the
// property being protected — every public route has a canonical URL and a
// same-origin social card — is checked there instead.
test('F-8 public routes declare canonical URLs and a same-origin social card', async () => {
  const layout = await readFile('apps/web/app/layout.tsx', 'utf8');

  for (const field of ['openGraph', 'twitter', 'metadataBase']) {
    assert.ok(layout.includes(field), `the root layout must declare ${field}`);
  }
  // A social image on someone else's origin is a dead card the day they move it.
  assert.doesNotMatch(
    layout.replace(/metadataBase[^\n]*\n/u, ''),
    /https?:\/\/(?!talk-active-id\.vercel\.app)[^'"\s]+/u,
    'social and metadata assets must stay on our own origin',
  );

  for (const route of [
    'apps/web/app/(marketing)/page.tsx',
    'apps/web/app/(auth)/enter/page.tsx',
  ]) {
    const source = await readFile(route, 'utf8');
    assert.match(source, /alternates:\s*\{\s*canonical:/u, `${route} must declare a canonical URL`);
  }
});

// The static 404.html and robots.txt belonged to the vanilla build and went
// with it. Next owns both surfaces now, so only one runtime is left to check.
test('F-8 the Next runtime exposes robots and a branded not-found surface', async () => {
  const [layout, nextNotFound, nextRobots, idMessages, enMessages] = await Promise.all([
    readFile('apps/web/app/layout.tsx', 'utf8'),
    readFile('apps/web/app/not-found.tsx', 'utf8'),
    readFile('apps/web/app/robots.ts', 'utf8'),
    readFile('apps/web/messages/id.json', 'utf8'),
    readFile('apps/web/messages/en.json', 'utf8'),
  ]);
  assert.match(layout, /metadataBase: new URL\('https:\/\/talk-active-id\.vercel\.app'\)/u);
  assert.match(layout, /openGraph:/u);
  assert.match(layout, /twitter:/u);
  assert.match(nextNotFound, /t\('heading'\)/u);
  assert.match(JSON.parse(idMessages).notFound.heading, /bukan bagian dari ruang kerja latihan/u);
  assert.match(JSON.parse(enMessages).notFound.heading, /not part of the rehearsal workspace/u);
  assert.match(nextRobots, /userAgent: '\*', allow: '\/'/u);
});
