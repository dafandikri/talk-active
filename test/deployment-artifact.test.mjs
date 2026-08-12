import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPublic, PUBLIC_RUNTIME_FILES } from '../scripts/build-public.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function filesBelow(directory, root = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path, root) : [relative(root, path)];
  });
}

test('Vercel publishes only the explicit product runtime', (context) => {
  const temporaryRoot = mkdtempSync(join(ROOT, '.tmp-public-'));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const output = join(temporaryRoot, 'public');

  const result = buildPublic({ root: ROOT, output });
  const files = filesBelow(output).sort();

  assert.deepEqual(files, [...PUBLIC_RUNTIME_FILES].sort());
  assert.equal(result.files, PUBLIC_RUNTIME_FILES.length);
  assert.ok(result.bytes < 1_000_000, `public artifact unexpectedly grew to ${result.bytes} bytes`);
  assert.equal(statSync(join(output, 'index.html')).isFile(), true);
  assert.equal(statSync(join(output, 'src/app.mjs')).isFile(), true);
  assert.equal(statSync(join(output, 'src/assets/LOGO.png')).isFile(), true);
  assert.equal(statSync(join(output, 'src/assets/LOGO-dashboard.png')).isFile(), true);
  assert.equal(statSync(join(output, 'src/assets/LOGO & TAGLINE.png')).isFile(), true);
  assert.equal(files.some((file) => file.startsWith('docs/')), false);
  assert.equal(files.some((file) => file.startsWith('test/')), false);
  assert.equal(files.some((file) => file.startsWith('scripts/')), false);
  assert.equal(files.includes('AGENTS.md'), false);
});

// The test above compares the build against the manifest, so the manifest is
// both the input and the expectation and a *missing* file can never fail it.
// On 12 August src/analysis-progress.mjs was imported by src/app.mjs and left
// out of the manifest. It 404'd in production, app.mjs never finished
// evaluating, no listener was ever attached, and every control in the
// workspace was dead — while pnpm check stayed green, because scripts/serve.mjs
// serves the source tree rather than the built output.
//
// This walks the real reference graph from each HTML entry point instead.
function referencesFrom(relativePath, seen = new Set()) {
  if (seen.has(relativePath)) return seen;
  seen.add(relativePath);
  let source;
  try {
    source = readFileSync(join(ROOT, relativePath), 'utf8');
  } catch {
    return seen;
  }
  const directory = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
  const found = [];

  if (relativePath.endsWith('.html')) {
    for (const match of source.matchAll(/(?:src|href)="(\/[^"?#]+)"/gu)) found.push(match[1].slice(1));
  } else if (relativePath.endsWith('.mjs') || relativePath.endsWith('.js')) {
    // Static imports only. A dynamic import is a runtime concern, not a build one.
    for (const match of source.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gmu)) found.push(match[1]);
    for (const match of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gmu)) found.push(match[1]);
  } else if (relativePath.endsWith('.css')) {
    for (const match of source.matchAll(/url\(\s*['"]?(\/[^'")?#]+)/gu)) found.push(match[1].slice(1));
  }

  for (const reference of found) {
    if (/^(?:https?:)?\/\//u.test(reference) || reference.startsWith('data:')) continue;
    const resolved = reference.startsWith('/')
      ? reference.slice(1)
      : join(directory, reference).split('\\').join('/');
    referencesFrom(resolved, seen);
  }
  return seen;
}

test('every file the shipped pages actually reference is in the build manifest', () => {
  const manifest = new Set(PUBLIC_RUNTIME_FILES);
  const entries = ['index.html', 'brief.html', 'booth.html'];
  const reachable = new Set();
  for (const entry of entries) for (const file of referencesFrom(entry)) reachable.add(file);

  const missing = [...reachable]
    .filter((file) => !manifest.has(file))
    // Only files that exist in the repo can be published; anything else is a
    // broken link, which is a different bug with a different test.
    .filter((file) => { try { return statSync(join(ROOT, file)).isFile(); } catch { return false; } });

  assert.deepEqual(
    missing,
    [],
    `these files are referenced by a shipped page but never copied into public/, so they will 404 in production: ${missing.join(', ')}`,
  );
});

test('Vercel builds and serves the Next.js application', () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const ignored = readFileSync(join(ROOT, '.vercelignore'), 'utf8');

  assert.equal(vercel.framework, 'nextjs');
  assert.match(vercel.buildCommand, /@talk-active\/web build/u);
  // No outputDirectory: the nextjs framework handler resolves .next relative
  // to the build, and naming a path outside that layout is a known way to
  // stop Vercel recognising the app at all.
  assert.equal(vercel.outputDirectory, undefined);
  assert.match(ignored, /^docs\/$/mu);
  assert.match(ignored, /^test\/$/mu);
  assert.match(ignored, /^AGENTS\.md$/mu);
  // The Next app imports these from src/assets, so excluding them would break
  // the build rather than merely shrink it.
  assert.doesNotMatch(ignored, /^src\/assets\/LOGO(?: & TAGLINE)?\.png$/mu);
  assert.doesNotMatch(ignored, /^src\/assets\/?$/mu);
});
