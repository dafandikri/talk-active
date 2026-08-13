import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseRubric } from '../apps/web/lib/analyzer.ts';
import {
  RUBRIC_TEMPLATES,
  RubricTemplateSchema,
  templateRubricText,
} from '../apps/web/lib/rubric-library.ts';
import {
  LEGACY_RUBRIC_STORAGE_KEY,
  readRubricSourceType,
  readStoredRubricCriteria,
  RUBRIC_STORAGE_KEY,
  RUBRIC_SOURCE_STORAGE_KEY,
  writeStoredRubricCriteria,
} from '../apps/web/lib/rubric-storage.ts';

const editorSource = await readFile(
  new URL('../apps/web/components/rubric-editor.tsx', import.meta.url),
  'utf8',
);

test('F-9 ships five distinct, structurally valid starter contexts', () => {
  assert.equal(RUBRIC_TEMPLATES.length, 5);
  assert.equal(new Set(RUBRIC_TEMPLATES.map(({ id }) => id)).size, 5);
  assert.deepEqual(
    RUBRIC_TEMPLATES.map(({ name }) => name),
    ['Hackathon pitch', 'Skripsi defense', 'Scholarship interview', 'PKM presentation', 'Job interview'],
  );

  for (const template of RUBRIC_TEMPLATES) {
    assert.equal(RubricTemplateSchema.safeParse(template).success, true);
    assert.ok(template.criteria.length >= 3 && template.criteria.length <= 8);
    for (const criterion of template.criteria) {
      assert.ok(criterion.requiredEvidence.length >= 2);
    }
  }
});

test('F-9 starter text remains compatible with the production rubric parser', () => {
  for (const template of RUBRIC_TEMPLATES) {
    const parsed = parseRubric(templateRubricText(template));
    assert.equal(parsed.length, template.criteria.length, template.name);
    assert.deepEqual(
      parsed.map(({ label }) => label),
      template.criteria.map(({ name }) => name),
      template.name,
    );
  }
});

test('A-1 repeated criterion names keep distinct deterministic ids', () => {
  const parsed = parseRubric('Impact | beneficiary\nImpact | measurable outcome\nImpact-2 | scale');
  assert.equal(new Set(parsed.map(({ id }) => id)).size, 3);
  assert.deepEqual(parsed.map(({ id }) => id), ['impact', 'impact-2', 'impact-2-2']);
});

test('A-1 v1 rubric storage migrates evidence phrases into the typed v2 contract', () => {
  const values = new Map([[LEGACY_RUBRIC_STORAGE_KEY, JSON.stringify([{
    id: 'method-fit',
    name: 'Method fit',
    evidence: 'research question, sample size; trade-off',
    sourceExcerpt: 'Method fit — 20 points',
  }])]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const migrated = readStoredRubricCriteria(storage);
  assert.ok(migrated);
  assert.deepEqual(migrated[0].requiredEvidence, ['research question', 'sample size', 'trade-off']);
  assert.equal(migrated[0].description, '');

  const saved = writeStoredRubricCriteria(storage, migrated);
  assert.equal(saved[0].sourceExcerpt, 'Method fit — 20 points');
  assert.match(values.get(RUBRIC_STORAGE_KEY), /"version":2/u);
});

test('A-1 v2 storage retains a named description-only criterion', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  writeStoredRubricCriteria(storage, [{
    id: 'ethics',
    name: 'Ethics',
    description: 'Explain the stated participant safeguards',
    requiredEvidence: [],
    sourceExcerpt: 'Ethics: Explain the stated participant safeguards',
    displayOrder: 0,
  }]);
  assert.deepEqual(readStoredRubricCriteria(storage)?.[0].requiredEvidence, []);
  assert.equal(
    readStoredRubricCriteria(storage)?.[0].description,
    'Explain the stated participant safeguards',
  );
  assert.match(editorSource, /filter\(\(criterion\) => criterion\.name\)/u);
  assert.match(editorSource, /sourceExcerpt: null/u);
});

test('F-9 records only a known rubric source and defaults invalid storage safely', () => {
  for (const sourceType of ['manual', 'imported', 'library']) {
    assert.equal(readRubricSourceType({ getItem: () => sourceType }), sourceType);
  }
  assert.equal(readRubricSourceType({ getItem: () => 'official' }), 'manual');
  assert.equal(readRubricSourceType({ getItem: () => null }), 'manual');
  assert.equal(RUBRIC_SOURCE_STORAGE_KEY, 'talkactive.production.rubric-source.v1');
});

// Restored 13 August. The declutter removed the "not official scoring rubrics"
// sentence and this assertion with it. The sentence is what stops a starter
// being mistaken for the evaluator's own matrix, which is the whole reason a
// student would rehearse against the wrong criteria.
test('F-9 tells users templates are unofficial and never auto-saved', () => {
  assert.match(editorSource, /not official scoring rubrics/iu);
  assert.match(editorSource, /starter loaded but not saved/iu);
  assert.match(editorSource, /confirm with Save rubric/iu);
});
