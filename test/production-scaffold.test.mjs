import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

test('M-1 leaves the deployed vanilla build path unchanged until cutover', () => {
  assert.ok(existsSync(join(ROOT, 'apps/web/app/layout.tsx')));
  assert.equal(JSON.parse(read('package.json')).scripts.build, 'node scripts/build-public.mjs');
  assert.equal(JSON.parse(read('vercel.json')).outputDirectory, 'public');
  assert.match(read('apps/web/package.json'), /"next": "16\.3\.0"/u);
  assert.match(read('apps/web/package.json'), /next build --turbopack/u);
});

test('P0-1 exposes one schema contract to both UI and route handlers', () => {
  const contracts = read('apps/web/lib/contracts.ts');
  const component = read('apps/web/components/production-shell.tsx');
  const route = read('apps/web/app/api/health/route.ts');

  for (const schema of [
    'ProjectSchema',
    'RubricSchema',
    'CriterionSchema',
    'AttemptSchema',
    'EvidenceVerdictSchema',
    'QuestionSchema',
    'DefenseAnswerSchema',
    'SourceDocumentSchema',
  ]) {
    assert.match(contracts, new RegExp(`export const ${schema}\\b`, 'u'), `${schema} is absent from the shared contract`);
  }
  assert.match(component, /from '@\/lib\/contracts'/u, 'the frontend must consume the shared contract');
  assert.match(route, /from '@\/lib\/contracts'/u, 'route handlers must validate with the shared contract');
});

test('the contract structurally enforces cited support and explicit gaps', () => {
  const contracts = read('apps/web/lib/contracts.ts');
  assert.match(contracts, /verdict !== 'unsupported'[\s\S]+citedSpan/u);
  assert.match(contracts, /verdict === 'unsupported'[\s\S]+missingEvidence/u);
  assert.match(contracts, /engine: EvidenceEngineSchema/u, 'provenance must be stored per verdict');
});

test('M-3 keeps the TypeScript analyzer inside the production app', () => {
  const analyzer = read('apps/web/lib/analyzer.ts');
  assert.match(analyzer, /export function analyzeSpeech/u);
  assert.match(analyzer, /export class AnalysisError/u);
  assert.doesNotMatch(analyzer, /\bany\b/u, 'the strict port must not bypass TypeScript with any');
});

test('M-4 keeps deterministic grounding separate from model judgment', () => {
  const grounding = read('apps/web/lib/grounding.ts');
  assert.match(grounding, /export function spanIsGrounded/u);
  assert.match(grounding, /export function findGroundedSpan/u);
  assert.match(grounding, /MIN_SPAN_CHARS = 12/u);
  assert.doesNotMatch(grounding, /fetch\s*\(|generateText|from ['"]ai['"]/iu);
});

test('M-5 keeps the evidence judge per-criterion and uses both failover layers', () => {
  const judge = read('apps/web/lib/ai/evidence-judge.ts');
  assert.match(judge, /Output\.object/u);
  assert.match(judge, /models: request\.fallbackModels/u);
  assert.match(judge, /zeroDataRetention: true/u);
  assert.match(judge, /Promise\.allSettled/u);
  assert.match(judge, /findGroundedSpan/u);
  assert.doesNotMatch(judge, /AI_EVIDENCE_MODEL\s*\?\?\s*['"][^'"]+['"]/u, 'model tiers must be configured, not illustrative IDs baked into code');
});
