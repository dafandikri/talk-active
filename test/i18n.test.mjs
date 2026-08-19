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

// The delivery panel resolves its copy with computed keys — t(`${key}.label`)
// — so the source scan above cannot see them. A metric whose catalogue entry
// was never written would render "deliveryMetrics.framingCoverage.label" onto
// a chart, and no other test would notice. The ids are the contract, so they
// are checked against the catalogue directly.
test('every delivery metric has a complete catalogue entry in both locales', () => {
  const source = readFileSync(join(WEB, 'lib/delivery-metrics.ts'), 'utf8');
  const union = source.slice(
    source.indexOf('export type DeliveryMetricId'),
    source.indexOf(';', source.indexOf('export type DeliveryMetricId')),
  );
  const ids = [...union.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1]);
  assert.ok(ids.length >= 9, `expected the metric id union, found ${ids.length}`);

  for (const locale of ['id', 'en']) {
    const metrics = catalogue(locale).deliveryMetrics;
    for (const id of ids) {
      const key = id.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      const entry = metrics[key];
      assert.ok(entry, `${locale}.json is missing deliveryMetrics.${key}`);
      for (const field of ['label', 'unit', 'measured']) {
        assert.ok(entry[field], `${locale}.json:deliveryMetrics.${key}.${field} is missing`);
      }
      // Every metric needs a target phrasing: either the plain one, or the
      // mode-specific pair that movement-activity uses.
      assert.ok(
        entry.target || (entry.targetPresentation && entry.targetInterview),
        `${locale}.json:deliveryMetrics.${key} has no target phrasing`,
      );
    }
  }
});

// The register is the point of the landing redesign, and it is exactly the kind
// of thing that silently reverts when someone edits one string. `Anda` is the
// form you use with a stranger; the front door speaks as a peer, and nothing
// behind the workspace frame does.
test('the landing namespace speaks casually and no other namespace does', () => {
  const id = catalogue('id');
  const landingText = Object.values(id.landing).join(' ');
  assert.match(landingText, /\bkamu\b/iu, 'the landing page must address the reader as kamu');
  assert.doesNotMatch(landingText, /\bAnda\b/u, 'the landing page must not mix in the formal register');

  for (const [namespace, entries] of Object.entries(id)) {
    if (namespace === 'landing') continue;
    const text = Object.values(entries).join(' ');
    assert.doesNotMatch(text, /\bkamu\b/iu,
      `${namespace} must keep the formal register; casual copy is landing-only`);
  }
});

// The register boundary above is right in the middle of the product and wrong
// at the front door. /enter is the very next screen after the landing
// headline, so switching from kamu to Anda between one click and the next
// reads as the product going cold on the reader at the moment they commit.
//
// The fix is not to make the entry gate casual — it is a utility screen and
// slang would be worse there — but to let it address nobody. Indonesian drops
// the pronoun as ordinary idiom, so these sentences read as natural rather
// than as evasion, which is what the same move would look like in English.
// The absence of `kamu` here is already covered by the landing-only rule.
test('the entry gate uses no second-person pronoun, so the register never switches', () => {
  const entryGate = Object.values(catalogue('id').entryGate).join(' ');
  assert.doesNotMatch(
    entryGate,
    /\bAnda\b/u,
    'the entry gate must address nobody: the reader arrives here from a page that said kamu',
  );
});
