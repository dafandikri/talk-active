import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

// Cut over on 12 August. This guard used to assert the opposite — that
// vercel.json still pointed at the vanilla build — and it was right to until
// the decision was actually made. It now guards the destination instead.
test('M-13 production is deployed from the Next.js app', () => {
  assert.ok(existsSync(join(ROOT, 'apps/web/app/layout.tsx')));
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.framework, 'nextjs');
  assert.equal(vercel.outputDirectory, undefined);
  assert.match(vercel.buildCommand, /@talk-active\/web build/u);
  assert.match(read('apps/web/package.json'), /"next": "16\.3\.0"/u);
  assert.match(read('apps/web/package.json'), /next build --turbopack/u);
});

// The vanilla deployment carried these headers in vercel.json. Moving the
// build moved their home to next.config.ts, and a header that quietly stops
// being sent is the failure nobody notices — so it is asserted rather than
// trusted.
test('M-13 the security headers survived the move to next.config.ts', () => {
  const config = read('apps/web/next.config.ts');
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(config.includes(directive), `Content-Security-Policy lost ${directive}`);
  }
  for (const header of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(config.includes(header), `${header} is no longer sent`);
  }

  // script-src is deliberately weaker than the vanilla build's, because a
  // per-request nonce cannot exist on a statically prerendered page. INV-4
  // says a boundary is stated, not hidden: if someone tightens or further
  // loosens this, they have to edit the reasoning next to it.
  assert.ok(
    config.includes("script-src 'self' 'unsafe-inline'"),
    'script-src changed without the accompanying justification being revisited',
  );
  assert.match(
    config,
    /statically prerendered|prerender/iu,
    'the reason script-src carries unsafe-inline must stay next to the policy',
  );
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
