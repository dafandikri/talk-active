import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEvidenceGatewayOptions,
  buildEvidenceMessages,
  buildEvidencePrompt,
  EvidenceJudgeOutputSchema,
  judgeCriterion,
  judgeEvidence,
  MAX_EVIDENCE_SPAN_CHARS,
  rejudgeCriterionAfterRejection,
} from '../apps/web/lib/ai/evidence-judge.ts';

const CRITERION = {
  id: 'criterion-differentiation',
  rubricId: 'rubric-1',
  name: 'Differentiation',
  description: 'Explain the unique product mechanism.',
  requiredEvidence: ['alternative', 'unique mechanism'],
  displayOrder: 0,
};

const TRANSCRIPT = 'Unlike generic delivery coaches, Talk-Active starts from the evaluator rubric.';

test('M-5 output contract keeps reasoning internal and requires every non-supported gap', () => {
  const partialWithoutGap = EvidenceJudgeOutputSchema.safeParse({
    reasoning: 'The mechanism is present but the comparison is incomplete.',
    verdict: 'partial',
    citedSpan: 'Unlike generic delivery coaches',
    missingEvidence: [],
  });
  const unsupportedWithCitation = EvidenceJudgeOutputSchema.safeParse({
    reasoning: 'The evidence does not satisfy the criterion.',
    verdict: 'unsupported',
    citedSpan: 'Unlike generic delivery coaches',
    missingEvidence: ['unique mechanism'],
  });

  assert.equal(partialWithoutGap.success, false);
  assert.equal(unsupportedWithCitation.success, false);
});

test('M-5 accepts a structured semantic verdict only after mapping it to the original span', async () => {
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/small-tier',
    generate: async () => ({
      output: {
        reasoning: 'The transcript directly contrasts the product with a generic alternative.',
        verdict: 'supported',
        citedSpan: 'unlike generic delivery coaches',
        missingEvidence: [],
      },
      modelId: 'test/answering-model',
    }),
  });

  assert.equal(result.engine, 'semantic');
  assert.equal(result.citedSpan, 'Unlike generic delivery coaches');
  assert.equal(result.model, 'test/answering-model');
  assert.equal(result.attempts, 1);
});

test('M-5 retries a fabricated citation once with the rejected span as new information', async () => {
  const requests = [];
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/small-tier',
    generate: async (request) => {
      requests.push(request);
      return requests.length === 1
        ? {
            output: { reasoning: 'The sentence appears to support the comparison.', verdict: 'supported', citedSpan: 'We dominate every competitor.', missingEvidence: [] },
            modelId: 'test/model',
          }
        : {
            output: { reasoning: 'The alternative is named but an outcome is still absent.', verdict: 'partial', citedSpan: 'Unlike generic delivery coaches', missingEvidence: ['outcome evidence'] },
            modelId: 'test/model',
          };
    },
  });

  assert.equal(requests.length, 2);
  assert.match(requests[1].correction, /We dominate every competitor/u);
  assert.equal(result.engine, 'semantic');
  assert.equal(result.verdict, 'partial');
  assert.equal(result.attempts, 2);
});

test('M-5 rejects over-quoted evidence and retries with a bounded exact passage', async () => {
  const longPassage = `${'Long supporting context. '.repeat(20)}Unlike generic delivery coaches.`;
  const requests = [];
  const result = await judgeCriterion(longPassage, CRITERION, {
    model: 'test/small-tier',
    generate: async (request) => {
      requests.push(request);
      return requests.length === 1
        ? {
            output: {
              reasoning: 'The full passage contains relevant evidence.',
              verdict: 'partial',
              citedSpan: longPassage,
              missingEvidence: ['unique mechanism'],
            },
            modelId: 'test/model',
          }
        : {
            output: {
              reasoning: 'The smallest exact comparison is sufficient.',
              verdict: 'partial',
              citedSpan: 'Unlike generic delivery coaches',
              missingEvidence: ['unique mechanism'],
            },
            modelId: 'test/model',
          };
    },
  });

  assert.ok(longPassage.length > MAX_EVIDENCE_SPAN_CHARS);
  assert.equal(requests.length, 2);
  assert.match(requests[1].correction, new RegExp(String(MAX_EVIDENCE_SPAN_CHARS), 'u'));
  assert.equal(result.citedSpan, 'Unlike generic delivery coaches');
  assert.equal(result.attempts, 2);
});

test('A-5 re-judges a student rejection exactly once with the old span as a hard negative', async () => {
  const requests = [];
  const result = await rejudgeCriterionAfterRejection(TRANSCRIPT, CRITERION, {
    verdict: 'supported',
    coverageScore: 1,
    citedSpan: 'Unlike generic delivery coaches',
    missingEvidence: [],
    engine: 'semantic',
  }, {
    model: 'test/small-tier',
    generate: async (request) => {
      requests.push(request);
      return {
        output: {
          reasoning: 'A different exact passage explains the mechanism but not the comparison.',
          verdict: 'partial',
          citedSpan: 'Talk-Active starts from the evaluator rubric',
          missingEvidence: ['measured comparison'],
        },
        modelId: 'test/model',
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].correction, /hard negative/u);
  assert.match(requests[0].correction, /Unlike generic delivery coaches/u);
  assert.equal(result.verdict, 'partial');
  assert.equal(result.citedSpan, 'Talk-Active starts from the evaluator rubric');
});

test('A-5 settles unsupported when the one re-judge repeats rejected evidence', async () => {
  let calls = 0;
  const result = await rejudgeCriterionAfterRejection(TRANSCRIPT, CRITERION, {
    verdict: 'supported',
    coverageScore: 1,
    citedSpan: 'Unlike generic delivery coaches',
    missingEvidence: [],
    engine: 'semantic',
  }, {
    model: 'test/small-tier',
    generate: async () => {
      calls += 1;
      return {
        output: {
          reasoning: 'The original citation appears to support the criterion.',
          verdict: 'supported',
          citedSpan: 'Unlike generic delivery coaches',
          missingEvidence: [],
        },
        modelId: 'test/model',
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.verdict, 'unsupported');
  assert.equal(result.citedSpan, null);
  assert.match(result.degradedReason, /repeated the rejected span/u);
});

test('M-5 labels deterministic fallback after two ungrounded semantic responses', async () => {
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/small-tier',
    generate: async () => ({
      output: { reasoning: 'This appears to be supporting evidence.', verdict: 'supported', citedSpan: 'A fabricated sentence long enough to pass length.', missingEvidence: [] },
      modelId: 'test/model',
    }),
  });

  assert.equal(result.engine, 'deterministic');
  assert.equal(result.attempts, 2);
  assert.match(result.degradedReason, /could not be grounded/u);
  assert.ok(result.citedSpan || result.missingEvidence.length > 0);
});

test('M-5 lets Gateway own transport failover and does not blindly repeat an outage', async () => {
  let calls = 0;
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/primary',
    fallbackModels: ['test/fallback-a', 'test/fallback-b'],
    generate: async (request) => {
      calls += 1;
      assert.deepEqual(request.fallbackModels, ['test/fallback-a', 'test/fallback-b']);
      throw new Error('transport down');
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.engine, 'deterministic');
  assert.match(result.degradedReason, /provider was unavailable/u);
});

test('A-4 warms one isolated criterion, then fans out the remaining calls', async () => {
  const criteria = [
    CRITERION,
    { ...CRITERION, id: 'criterion-feasibility', name: 'Feasibility', displayOrder: 1 },
    { ...CRITERION, id: 'criterion-impact', name: 'Impact', displayOrder: 2 },
  ];
  const seen = [];
  let active = 0;
  let maximumActive = 0;
  let firstFinished = false;
  const events = [];

  const results = await judgeEvidence(TRANSCRIPT, criteria, {
    model: 'test/small-tier',
    onEvent: (event) => events.push(event),
    generate: async (request) => {
      if (request.criterion.id !== CRITERION.id) assert.equal(firstFinished, true);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      seen.push(buildEvidencePrompt(request));
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      if (request.criterion.id === CRITERION.id) firstFinished = true;
      return {
        output: { reasoning: 'The transcript does not include the required direct evidence.', verdict: 'unsupported', citedSpan: null, missingEvidence: ['direct evidence'] },
        modelId: 'test/model',
        cacheReadTokens: request.criterion.id === CRITERION.id ? 0 : 120,
        cacheWriteTokens: request.criterion.id === CRITERION.id ? 120 : 0,
      };
    },
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(results.map((result) => result.criterionId), criteria.map((criterion) => criterion.id));
  for (const [index, prompt] of seen.entries()) {
    const ownCriterion = criteria[index];
    assert.match(prompt, new RegExp(ownCriterion.name, 'u'));
    for (const other of criteria.filter((criterion) => criterion.id !== ownCriterion.id)) {
      assert.doesNotMatch(prompt, new RegExp(`"name": "${other.name}"`, 'u'));
    }
  }
  const attempts = events.filter((event) => event.type === 'evidence_attempt_completed');
  assert.deepEqual(attempts.map((event) => event.cacheReadTokens), [0, 120, 120]);
  assert.deepEqual(attempts.map((event) => event.cacheWriteTokens), [120, 0, 0]);
});

test('A-4 keeps the transcript prefix byte-identical while criteria vary', () => {
  const feasibility = { ...CRITERION, id: 'criterion-feasibility', name: 'Feasibility' };
  const first = buildEvidenceMessages({ transcript: TRANSCRIPT, criterion: CRITERION, correction: null });
  const second = buildEvidenceMessages({ transcript: TRANSCRIPT, criterion: feasibility, correction: null });
  const firstParts = first[0].content;
  const secondParts = second[0].content;

  assert.equal(Array.isArray(firstParts), true);
  assert.equal(Array.isArray(secondParts), true);
  assert.deepEqual(firstParts[0], secondParts[0]);
  assert.deepEqual(firstParts[0].providerOptions, {
    anthropic: { cacheControl: { type: 'ephemeral' } },
  });
  assert.notEqual(firstParts[1].text, secondParts[1].text);
  assert.match(firstParts[0].text, new RegExp(TRANSCRIPT, 'u'));
  assert.deepEqual(buildEvidenceGatewayOptions({ fallbackModels: ['test/fallback'] }), {
    caching: 'auto',
    tags: ['evidence-judge', 'contract-v2'],
    models: ['test/fallback'],
  });
});

test('M-5 uses deterministic mode immediately when the semantic tier is unconfigured', async () => {
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, { model: '' });
  assert.equal(result.engine, 'deterministic');
  assert.equal(result.attempts, 0);
  assert.match(result.degradedReason, /not configured/u);
});

test('A-1 emits per-model grounding outcomes without transcript or citation content', async () => {
  const events = [];
  const fabricatedSpan = 'A private fabricated sentence that is not in the rehearsal.';
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/requested-tier',
    onEvent: (event) => events.push(event),
    generate: async () => ({
      output: { reasoning: 'This appears to support the criterion.', verdict: 'supported', citedSpan: fabricatedSpan, missingEvidence: [] },
      modelId: 'test/answering-model',
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
    }),
  });

  assert.equal(result.engine, 'deterministic');
  assert.deepEqual(events.map((event) => event.type), [
    'evidence_attempt_completed',
    'evidence_attempt_completed',
    'evidence_criterion_completed',
  ]);
  assert.deepEqual(events.slice(0, 2).map((event) => event.outcome), [
    'grounding_rejected',
    'grounding_rejected',
  ]);
  assert.equal(events[0].answeringModel, 'test/answering-model');
  assert.equal(events[0].cacheReadTokens, 80);
  assert.equal(events[0].cacheWriteTokens, 0);
  assert.equal(events[2].groundingRejections, 2);
  assert.equal(events[2].fallbackCategory, 'grounding_failed');
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, new RegExp(TRANSCRIPT, 'u'));
  assert.doesNotMatch(serialized, new RegExp(fabricatedSpan, 'u'));
  assert.doesNotMatch(serialized, /citedSpan|missingEvidence|transcript/u);
});

test('A-1 logging failures never replace a grounded product verdict', async () => {
  const result = await judgeCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/small-tier',
    onEvent: () => { throw new Error('observability unavailable'); },
    generate: async () => ({
      output: {
        reasoning: 'The transcript directly contrasts the product with a generic alternative.',
        verdict: 'supported',
        citedSpan: 'Unlike generic delivery coaches',
        missingEvidence: [],
      },
      modelId: 'test/answering-model',
    }),
  });

  assert.equal(result.engine, 'semantic');
  assert.equal(result.citedSpan, 'Unlike generic delivery coaches');
});
