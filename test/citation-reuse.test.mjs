import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { detectReusedCitations } from '../apps/web/lib/citation-reuse.ts';
import { EvidenceResponseSchema } from '../apps/web/lib/contracts.ts';

const SPAN = 'Our rubric maps every claim to the evidence an evaluator expects.';

function verdict(criterionId, citedSpan = SPAN) {
  return {
    id: `verdict-${criterionId}`,
    attemptId: 'attempt-1',
    criterionId,
    stage: 'initial',
    verdict: 'supported',
    coverageScore: 1,
    citedSpan,
    missingEvidence: [],
    engine: 'semantic',
    verifierAgreed: true,
    verifierNote: null,
    studentOverridden: false,
    studentOverrideVerdict: null,
    createdAt: '2026-08-12T08:00:00.000Z',
  };
}

test('A-2 flags one normalised transcript span cited by distinct criteria', () => {
  const result = detectReusedCitations([
    { criterionId: 'criterion-grounding', citedSpan: 'Our rubric maps every claim\n to the evidence an evaluator expects.' },
    { criterionId: 'criterion-fit', citedSpan: SPAN },
    { criterionId: 'criterion-impact', citedSpan: null },
  ]);

  assert.deepEqual(result, [{
    citedSpan: 'Our rubric maps every claim\n to the evidence an evaluator expects.',
    criterionIds: ['criterion-grounding', 'criterion-fit'],
  }]);
});

test('A-2 does not flag one criterion twice or unrelated citations', () => {
  assert.deepEqual(detectReusedCitations([
    { criterionId: 'criterion-grounding', citedSpan: SPAN },
    { criterionId: 'criterion-grounding', citedSpan: SPAN },
    { criterionId: 'criterion-fit', citedSpan: 'A different grounded sentence supports this criterion.' },
  ]), []);
});

test('A-2 response contract keeps every reuse tied to returned verdicts', () => {
  const verdicts = [verdict('criterion-grounding'), verdict('criterion-fit')];
  const valid = EvidenceResponseSchema.safeParse({
    contractVersion: 2,
    attemptId: 'attempt-1',
    verdicts,
    reusedCitations: detectReusedCitations(verdicts),
    degraded: false,
  });
  assert.equal(valid.success, true);

  const unknownCriterion = EvidenceResponseSchema.safeParse({
    contractVersion: 2,
    attemptId: 'attempt-1',
    verdicts,
    reusedCitations: [{ citedSpan: SPAN, criterionIds: ['criterion-grounding', 'criterion-unknown'] }],
    degraded: false,
  });
  assert.equal(unknownCriterion.success, false);
});

test('A-2 detector is a deterministic post-pass with no model dependency', async () => {
  const source = await readFile('apps/web/lib/citation-reuse.ts', 'utf8');
  assert.doesNotMatch(source, /generateText|judgeCriterion|AI_GATEWAY/gu);

  const workspace = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  assert.match(workspace, /const judgments = await judgeEvidence[\s\S]+detectReusedCitations\(judgments\)/gu);
});
