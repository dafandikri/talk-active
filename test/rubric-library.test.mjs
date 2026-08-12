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
  readRubricSourceType,
  RUBRIC_SOURCE_STORAGE_KEY,
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

test('F-9 records only a known rubric source and defaults invalid storage safely', () => {
  for (const sourceType of ['manual', 'imported', 'library']) {
    assert.equal(readRubricSourceType({ getItem: () => sourceType }), sourceType);
  }
  assert.equal(readRubricSourceType({ getItem: () => 'official' }), 'manual');
  assert.equal(readRubricSourceType({ getItem: () => null }), 'manual');
  assert.equal(RUBRIC_SOURCE_STORAGE_KEY, 'talkactive.production.rubric-source.v1');
});

test('F-9 tells users templates are unofficial and never auto-saved', () => {
  assert.match(editorSource, /not official scoring rubrics/iu);
  assert.match(editorSource, /starter loaded but not saved/iu);
  assert.match(editorSource, /confirm with Save rubric/iu);
});
