import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps/web');

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const catalogue = (locale) => JSON.parse(read(`apps/web/messages/${locale}.json`));

function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return entry !== null && typeof entry === 'object'
      ? flatten(entry, path)
      : [[path, entry]];
  });
}

function sourceFiles(directory) {
  return readdirSync(join(WEB, directory), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

// A missing key is not a cosmetic defect. next-intl renders the key path
// itself, so `entryGate.submit` appears on a button where a sentence should be
// — visible to the user, and exactly the kind of thing nobody notices in the
// locale they do not personally read. INV-7 says analysis fails loudly; the
// same reasoning applies to the interface.

test('both catalogues declare exactly the same keys', () => {
  const id = new Set(flatten(catalogue('id')).map(([key]) => key));
  const en = new Set(flatten(catalogue('en')).map(([key]) => key));

  const missingFromEnglish = [...id].filter((key) => !en.has(key));
  const missingFromIndonesian = [...en].filter((key) => !id.has(key));

  assert.deepEqual(missingFromEnglish, [], 'keys present in id.json but not en.json');
  assert.deepEqual(missingFromIndonesian, [], 'keys present in en.json but not id.json');
});

test('no catalogue entry is blank, which would render as an invisible label', () => {
  for (const locale of ['id', 'en']) {
    for (const [key, value] of flatten(catalogue(locale))) {
      assert.equal(typeof value, 'string', `${locale}.json:${key} must be a string`);
      assert.ok(value.trim().length > 0, `${locale}.json:${key} is blank`);
    }
  }
});

test('every translation key a component asks for exists in both catalogues', () => {
  const known = new Set(flatten(catalogue('id')).map(([key]) => key));
  const lookups = [];

  for (const file of [...sourceFiles('components'), ...sourceFiles('app')]) {
    const source = readFileSync(file, 'utf8');
    // One namespace per component is the convention here; a file that adopts
    // several would need this widened, and the assertion below would say so
    // rather than silently checking the wrong namespace.
    const namespaces = [...new Set(
      [...source.matchAll(/useTranslations\('([^']+)'\)/gu)].map((m) => m[1]),
    )];
    if (namespaces.length === 0) continue;
    // A file may declare the same namespace in more than one component —
    // toast.tsx has two — but two DIFFERENT namespaces would make the key
    // prefix below ambiguous, and this says so rather than silently checking
    // keys against the wrong one.
    assert.equal(
      namespaces.length,
      1,
      `${file} uses ${namespaces.length} distinct namespaces; this check assumes one`,
    );
    // `t('k')`, `t('k', {…})` and `t.rich('k', {…})` all resolve a key. An
    // earlier version matched only the first form, which would have let a
    // missing key behind t.rich reach a user unnoticed — the exact failure
    // this test exists to prevent.
    for (const match of source.matchAll(/\bt(?:\.rich|\.markup)?\('([^']+)'\s*[,)]/gu)) {
      lookups.push({ file, key: `${namespaces[0]}.${match[1]}` });
    }
  }

  assert.ok(lookups.length > 0, 'no translation lookups found — the scan is broken, not the code');
  const unresolved = lookups.filter(({ key }) => !known.has(key));
  assert.deepEqual(
    unresolved.map(({ file, key }) => `${key} (${file})`),
    [],
    'these keys are read by a component and are not in the catalogue',
  );
});

test('the Indonesian catalogue is actually Indonesian, not English copied across', () => {
  // A catalogue that parses and has every key can still be untranslated, which
  // is the failure mode of a bulk extraction: the keys land, the translation
  // is postponed, and nothing ever fails. Identical strings are legitimate for
  // proper nouns, so this bounds the proportion rather than forbidding them.
  const id = new Map(flatten(catalogue('id')));
  const en = new Map(flatten(catalogue('en')));
  const shared = [...id.keys()].filter((key) => en.has(key));
  const identical = shared.filter((key) => id.get(key) === en.get(key));

  assert.ok(
    identical.length / shared.length < 0.25,
    `${identical.length} of ${shared.length} entries are byte-identical across locales: ${identical.join(', ')}`,
  );
});
