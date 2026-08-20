import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps/web');
const requireFromWeb = createRequire(join(WEB, 'package.json'));
const { parse } = requireFromWeb('next/dist/compiled/babel/parser');
const traverse = requireFromWeb('next/dist/compiled/babel/traverse').default;

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

// Messages are rendered as React text, not parsed as HTML. Writing `&amp;` in a
// JSON value therefore puts the six literal characters "&amp;" on the button.
// Keep entities out of the catalogue and store the intended Unicode text.
test('catalogue text contains characters rather than HTML entities', () => {
  for (const locale of ['id', 'en']) {
    for (const [key, value] of flatten(catalogue(locale))) {
      assert.doesNotMatch(
        value,
        /&(?:[A-Za-z]+|#\d+);/u,
        `${locale}.json:${key} contains an HTML entity that React will render literally`,
      );
    }
  }
});

test('the English format picker names Interview Q&A with an ampersand', () => {
  assert.equal(catalogue('en').practice.interviewQAmpA, 'Interview Q&A');
});

test('account status never exposes provider or API error prose', () => {
  const source = readFileSync(join(WEB, 'components/account-panel.tsx'), 'utf8');
  assert.doesNotMatch(
    source,
    /\.message\b/u,
    'account errors cross provider boundaries and must be mapped to catalogue messages',
  );
});

test('route metadata follows the interface catalogue', () => {
  for (const relative of [
    'app/layout.tsx',
    'app/(auth)/enter/page.tsx',
    'app/attempts/[id]/page.tsx',
  ]) {
    const source = readFileSync(join(WEB, relative), 'utf8');
    assert.doesNotMatch(source, /export const metadata\s*:/u, `${relative} hardcodes metadata`);
    assert.match(source, /getTranslations/u, `${relative} does not resolve localized metadata`);
  }
});

test('starter rehearsal surfaces select generated copy by project language', () => {
  const practice = readFileSync(join(WEB, 'components/practice-room.tsx'), 'utf8');
  const rubricEditor = readFileSync(join(WEB, 'components/rubric-editor.tsx'), 'utf8');
  const workspace = readFileSync(join(WEB, 'app/(workspace)/workspace/page.tsx'), 'utf8');

  assert.match(practice, /starterDraftFor\(/u);
  assert.match(practice, /defaultRubricFor\(/u);
  assert.match(rubricEditor, /defaultRubricFor\(language\)/u);
  assert.match(workspace, /defaultRubricFor\(language\)/u);
  for (const source of [practice, rubricEditor, workspace]) {
    assert.doesNotMatch(source, /\b(?:DEFAULT_RUBRIC|STARTER_DRAFT)\b/u,
      'a localized starter surface must not import the English-only compatibility constants');
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

function declaredStringMembers(relative, declaration) {
  const source = readFileSync(join(WEB, relative), 'utf8');
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${relative} no longer declares ${declaration}`);
  const end = source.indexOf(';', start);
  assert.notEqual(end, -1, `${declaration} has no terminating semicolon`);
  return [...source.slice(start, end).matchAll(/['"]([^'"]+)['"]/gu)]
    .map((match) => match[1]);
}

test('computed status, stage, recording, and vision keys exist in both catalogues', () => {
  const stages = declaredStringMembers('components/practice-room.tsx', 'type Stage =');
  const defenseStatuses = declaredStringMembers('lib/analyzer.ts', 'export type DefenseStatus =');
  const visionEvents = declaredStringMembers('lib/vision/types.ts', 'export type VisionEventKind =');
  const recordingStatuses = declaredStringMembers('lib/contracts.ts', 'export const RecordingStatusSchema =');
  const dictationStates = declaredStringMembers('lib/rehearsal/speech-recognition.ts', 'export type SpeechRecognitionState =');
  const engineModes = ['semantic', 'deterministic'];

  for (const locale of ['id', 'en']) {
    const messages = catalogue(locale);
    for (const stage of stages) {
      assert.ok(messages.practice.stage[stage], `${locale}.json:practice.stage.${stage} is missing`);
    }
    for (const status of defenseStatuses) {
      for (const namespace of ['practice', 'progressView', 'workspace']) {
        assert.ok(messages[namespace].defenseStatus[status],
          `${locale}.json:${namespace}.defenseStatus.${status} is missing`);
      }
    }
    for (const status of recordingStatuses) {
      for (const namespace of ['progressView', 'savedReview']) {
        assert.ok(messages[namespace].recordingStatus[status],
          `${locale}.json:${namespace}.recordingStatus.${status} is missing`);
      }
    }
    for (const kind of visionEvents) {
      for (const namespace of ['multimodalReview', 'savedReview']) {
        assert.ok(messages[namespace].visionEvent[kind],
          `${locale}.json:${namespace}.visionEvent.${kind} is missing`);
      }
    }
    for (const state of dictationStates) {
      assert.ok(messages.studio.dictationState[state],
        `${locale}.json:studio.dictationState.${state} is missing`);
    }
    for (const mode of engineModes) {
      assert.ok(messages.rubricEditor.modeLabel[mode],
        `${locale}.json:rubricEditor.modeLabel.${mode} is missing`);
      assert.ok(messages.practice.engineLabel[mode],
        `${locale}.json:practice.engineLabel.${mode} is missing`);
    }
  }
});

test('enum values are translated before they reach visible interpolation slots', () => {
  const rubricEditor = readFileSync(join(WEB, 'components/rubric-editor.tsx'), 'utf8');
  const studio = readFileSync(join(WEB, 'components/multimodal-studio.tsx'), 'utf8');
  const practice = readFileSync(join(WEB, 'components/practice-room.tsx'), 'utf8');

  assert.match(rubricEditor, /mode: t\(`modeLabel\.\$\{parsed\.mode\}`\)/u);
  assert.match(studio, /state: t\(`dictationState\.\$\{speechState\}`\)/u);
  assert.match(practice, /engine: t\(`engineLabel\.\$\{originalEngine\}`\)/u);
  assert.match(practice, /questionEngine: t\(`engineLabel\.\$\{response\.questionEngine\}`\)/u);
  assert.match(practice, /questionEngine: t\(`engineLabel\.\$\{completion\.hardestQuestion\.engine\}`\)/u);
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

// The test above proves every key a component ASKS for exists. It cannot see a
// sentence that was never routed through `t()` at all, and that blind spot hid
// roughly forty English strings on Indonesian screens — including three INV-4
// boundary disclosures whose bold lead was translated while the sentence
// carrying the actual limit was not. An Indonesian user was told "Batas:" and
// then read the limit itself in English.
//
// Parse the render tree instead of grepping individual source lines. JSX can
// split one sentence across elements, conditionals, and template literals; a
// line regex misses all three and was the reason the first extraction looked
// complete while short English labels still reached the Indonesian UI.
const NON_LOCALIZABLE_VISIBLE_TEXT = new Set([
  'Active',
  'Bahasa Indonesia',
  'EN',
  'English',
  'ID',
  'Talk-',
  'Talk-Active',
]);
const USER_VISIBLE_ATTRIBUTES = new Set(['alt', 'aria-label', 'placeholder', 'title']);

function normalizeJsxText(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function isInsideAriaHiddenElement(path) {
  return Boolean(path.findParent((candidate) => {
    if (!candidate.isJSXElement()) return false;
    return candidate.node.openingElement.attributes.some((attribute) => (
      attribute.type === 'JSXAttribute'
      && attribute.name.type === 'JSXIdentifier'
      && attribute.name.name === 'aria-hidden'
      && attribute.value?.type === 'StringLiteral'
      && attribute.value.value === 'true'
    ));
  }));
}

function renderedLiteralNodes(node) {
  if (!node) return [];
  if (node.type === 'StringLiteral') return [{ node, value: node.value }];
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((quasi) => ({ node: quasi, value: quasi.value.cooked ?? quasi.value.raw }));
  }
  if (node.type === 'ConditionalExpression') {
    return [...renderedLiteralNodes(node.consequent), ...renderedLiteralNodes(node.alternate)];
  }
  if (node.type === 'LogicalExpression') return renderedLiteralNodes(node.right);
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [...renderedLiteralNodes(node.left), ...renderedLiteralNodes(node.right)];
  }
  if (node.type === 'ParenthesizedExpression' || node.type === 'TSAsExpression') {
    return renderedLiteralNodes(node.expression);
  }
  return [];
}

test('no user-facing English is left outside the catalogue', () => {
  const offenders = [];

  for (const file of [...sourceFiles('components'), ...sourceFiles('app')]) {
    if (!file.endsWith('.tsx')) continue;
    const ast = parse(readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    const report = (node, raw) => {
      const value = normalizeJsxText(raw);
      if (!/[\p{L}]/u.test(value) || NON_LOCALIZABLE_VISIBLE_TEXT.has(value)) return;
      offenders.push(`${file}:${node.loc?.start.line ?? '?'} ${value.slice(0, 80)}`);
    };

    traverse(ast, {
      JSXText(path) {
        if (!isInsideAriaHiddenElement(path)) report(path.node, path.node.value);
      },
      JSXAttribute(path) {
        if (path.node.name.type !== 'JSXIdentifier'
          || !USER_VISIBLE_ATTRIBUTES.has(path.node.name.name)) return;
        if (path.node.value?.type === 'StringLiteral') {
          report(path.node.value, path.node.value.value);
        } else if (path.node.value?.type === 'JSXExpressionContainer') {
          for (const literal of renderedLiteralNodes(path.node.value.expression)) {
            report(literal.node, literal.value);
          }
        }
      },
      JSXExpressionContainer(path) {
        if (!path.parentPath.isJSXElement() && !path.parentPath.isJSXFragment()) return;
        if (isInsideAriaHiddenElement(path)) return;
        for (const literal of renderedLiteralNodes(path.node.expression)) {
          report(literal.node, literal.value);
        }
      },
    });
  }

  assert.deepEqual(offenders, [], 'these strings reach a user without passing through t()');
});
