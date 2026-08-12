import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

test('M-2 models the complete differentiating loop and stores provenance per verdict', () => {
  const schema = read('apps/web/lib/db/schema.ts');
  for (const table of [
    'projects',
    'rubrics',
    'criteria',
    'attempts',
    'evidenceVerdicts',
    'evidenceConfirmations',
    'questions',
    'defenseAnswers',
    'sourceDocuments',
  ]) {
    assert.match(schema, new RegExp(`export const ${table} = pgTable`, 'u'), `${table} is missing`);
  }
  assert.match(schema, /engine: evidenceEngine\('engine'\)\.notNull\(\)/u);
  assert.match(schema, /stage: evidenceStage\('stage'\)\.notNull\(\)/u);
  assert.match(schema, /from '\.\/auth-schema\.generated'/u);
  assert.match(schema, /userId: text\('user_id'\)\.references/u);
});

test('M-2 encodes traceability and deletion obligations in Postgres constraints', () => {
  const schema = read('apps/web/lib/db/schema.ts');
  assert.match(schema, /evidence_verdicts_supported_or_partial_has_span/u);
  assert.match(schema, /evidence_confirmations_verdict_unique/u);
  assert.match(schema, /judgedCitedSpan: text\('judged_cited_span'\)/u);
  assert.match(schema, /evidence_verdicts_unsupported_has_no_span/u);
  assert.match(schema, /evidence_verdicts_non_supported_has_gap/u);
  assert.match(schema, /evidence_confirmations_unsupported_has_no_span/u);
  assert.match(schema, /evidence_confirmations_non_supported_has_gap/u);
  assert.match(schema, /questionBasis\('basis'\)\.default\('legacy-unknown'\)\.notNull\(\)/u);
  assert.match(schema, /questions_source_basis_consistent/u);
  assert.match(schema, /source_documents_size_domain/u);
  assert.match(schema, /source_documents_content_type_allowed/u);
  assert.match(schema, /sourceDocumentId: uuid\('source_document_id'\)[\s\S]+onDelete: 'restrict'/u);
  assert.match(schema, /onDelete: 'cascade'/u);
  assert.doesNotMatch(schema, /audio|recording|soft.delete|deleted_at/iu);
});

test('M-2 checks in a generated SQL migration, not only an ORM declaration', () => {
  const migrations = join(ROOT, 'apps/web/drizzle');
  assert.ok(existsSync(migrations), 'apps/web/drizzle does not exist; run pnpm --filter @talk-active/web db:generate');
  const sqlFiles = readdirSync(migrations).filter((name) => name.endsWith('.sql'));
  assert.ok(sqlFiles.length >= 1, 'expected at least one generated migration');
  const migration = sqlFiles.map((name) => read(`apps/web/drizzle/${name}`)).join('\n');
  assert.match(migration, /CREATE TABLE "evidence_verdicts"/u);
  assert.match(migration, /"engine" "evidence_engine" NOT NULL/u);
  assert.match(migration, /ON DELETE cascade/u);
  assert.match(migration, /evidence_verdicts_supported_or_partial_has_span/u);
  assert.match(migration, /evidence_verdicts_unsupported_has_no_span/u);
  assert.match(migration, /evidence_verdicts_non_supported_has_gap/u);
  assert.match(migration, /CREATE TYPE "public"\."question_basis"/u);
  assert.match(migration, /questions_source_basis_consistent/u);
  assert.match(migration, /source_documents_size_domain/u);
  assert.match(migration, /source_documents_content_type_allowed/u);
});
