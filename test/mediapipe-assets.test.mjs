import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = join(ROOT, 'apps/web/public/mediapipe');
const PACKAGE_ROOT = join(ROOT, 'apps/web/node_modules/@mediapipe/tasks-vision');

const read = (path) => readFileSync(path);
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');
const manifest = JSON.parse(read(join(ASSET_ROOT, 'ASSET-MANIFEST.json')));

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(absolute) : [absolute];
    });
}

function distributableAssets(directory) {
  return filesUnder(directory)
    .filter((path) => /\.(?:js|task|wasm)$/u.test(path))
    // Manifest paths are URL-style on every platform; Node's relative() uses
    // the host separator, so normalize Windows discovery before comparing.
    .map((path) => relative(ASSET_ROOT, path).split(sep).join('/'))
    .sort();
}

function allManifestAssets() {
  return manifest.components.flatMap((component) => component.assets).sort((left, right) => (
    left.path.localeCompare(right.path)
  ));
}

test('INV-1 every redistributed MediaPipe asset has immutable provenance and a matching digest', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.hashAlgorithm, 'sha256');

  const assets = allManifestAssets();
  assert.deepEqual(
    assets.map((asset) => asset.path),
    distributableAssets(ASSET_ROOT),
    'every redistributed runtime or model file must appear exactly once in ASSET-MANIFEST.json',
  );

  for (const asset of assets) {
    const contents = read(join(ASSET_ROOT, asset.path));
    assert.equal(contents.byteLength, asset.bytes, `${asset.path} byte size drifted`);
    assert.equal(sha256(contents), asset.sha256, `${asset.path} SHA-256 drifted`);
  }

  for (const component of manifest.components) {
    assert.equal(component.modified, false, `${component.id} must disclose whether it was modified`);
    assert.equal(component.licenseConcluded, 'Apache-2.0', `${component.id} lost its license conclusion`);
    assert.ok(component.source.url.startsWith('https://'), `${component.id} needs an HTTPS source`);
    assert.ok(component.licenseEvidence.length > 0, `${component.id} needs license evidence`);
    for (const evidence of component.licenseEvidence) {
      assert.ok(evidence.assertion, `${component.id} has unexplained license evidence`);
      if (evidence.url) assert.ok(evidence.url.startsWith('https://'), `${component.id} has a non-HTTPS evidence URL`);
    }
  }

  for (const component of manifest.components.filter(({ source }) => source.type === 'google-cloud-storage')) {
    assert.match(component.version, /\/1$/u, `${component.id} must identify an explicit model version`);
    assert.match(component.source.url, /\/1\/[^/?]+$/u, `${component.id} must not use a mutable latest URL`);
    assert.equal(
      component.source.immutableUrl,
      `${component.source.url}?generation=${component.source.gcsGeneration}`,
      `${component.id} must retain its immutable GCS generation`,
    );
  }
});

test('the vendored runtime is byte-identical to the pinned Apache-2.0 npm package', () => {
  const packageMetadata = JSON.parse(read(join(PACKAGE_ROOT, 'package.json')));
  const packageComponent = manifest.components.find(({ id }) => id.startsWith('pkg:npm/'));

  assert.ok(packageComponent, 'npm package component is absent from the asset manifest');
  assert.equal(packageMetadata.name, packageComponent.name);
  assert.equal(packageMetadata.version, packageComponent.version);
  assert.equal(packageMetadata.license, packageComponent.licenseConcluded);
  assert.ok(
    read(join(ROOT, 'pnpm-lock.yaml')).includes(packageComponent.source.integrity),
    'the manifest npm integrity must match the lockfile',
  );

  for (const asset of packageComponent.assets) {
    assert.deepEqual(
      read(join(ASSET_ROOT, asset.path)),
      read(join(PACKAGE_ROOT, asset.packagePath)),
      `${asset.path} is no longer an unmodified copy from ${packageComponent.name}@${packageComponent.version}`,
    );
  }
});

test('the redistributed license is complete and the model-license boundary stays disclosed', () => {
  const license = read(join(ASSET_ROOT, manifest.licenseFiles['Apache-2.0'])).toString('utf8');
  const notice = read(join(ASSET_ROOT, 'NOTICE.md')).toString('utf8');

  assert.equal(
    sha256(license),
    'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
    'the redistributed Apache-2.0 text must remain byte-identical to the canonical license',
  );

  for (const requiredSection of [
    'Apache License',
    'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION',
    '2. Grant of Copyright License.',
    '3. Grant of Patent License.',
    '4. Redistribution.',
    '7. Disclaimer of Warranty.',
    '8. Limitation of Liability.',
    'END OF TERMS AND CONDITIONS',
  ]) {
    assert.ok(license.includes(requiredSection), `Apache-2.0 text lost ${requiredSection}`);
  }

  assert.match(notice, /Copyright 2022 The MediaPipe Authors/u);
  assert.match(notice, /Copyright 2023 The MediaPipe Authors/u);
  assert.match(notice, /do not contain a separately readable license file/iu);
  assert.match(notice, /does not independently reconstruct the license graph/iu);
});
