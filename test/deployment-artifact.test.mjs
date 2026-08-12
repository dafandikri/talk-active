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

test('Vercel is configured to serve the allow-list build output', () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const ignored = readFileSync(join(ROOT, '.vercelignore'), 'utf8');

  assert.equal(packageJson.scripts.build, 'node scripts/build-public.mjs');
  assert.equal(vercel.buildCommand, 'pnpm build');
  assert.equal(vercel.outputDirectory, 'public');
  assert.match(ignored, /^docs\/$/mu);
  assert.match(ignored, /^test\/$/mu);
  assert.match(ignored, /^AGENTS\.md$/mu);
  assert.doesNotMatch(ignored, /^src\/assets\/LOGO(?: & TAGLINE)?\.png$/mu);
});
