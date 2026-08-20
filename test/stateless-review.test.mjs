import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateStatelessDefense,
  rejudgeStatelessEvidence,
} from '../apps/web/lib/services/stateless-review.ts';
import {
  StatelessDefenseRequestSchema,
  StatelessRejudgeRequestSchema,
} from '../apps/web/lib/contracts.ts';

const CRITERION = {
  id: 'criterion-differentiation',
  rubricId: 'stateless-analysis',
  name: 'Differentiation',
  description: 'State the alternative, mechanism, and proof.',
  requiredEvidence: ['alternative', 'mechanism', 'proof'],
  displayOrder: 0,
};

test('A-5 stateless rejection runs one schema-bound re-judge and refreshes the question', async () => {
  const transcript = 'Unlike generic practice, our mechanism maps every claim to an exact rubric criterion.';
  const response = await rejudgeStatelessEvidence({
    transcript,
    criterion: CRITERION,
    // English transcript, English criterion, English assertion below. Stated
    // rather than inherited, since the contract default is now id-ID.
    language: 'en-US',
    rejected: {
      verdict: 'partial',
      coverageScore: 0.5,
      citedSpan: 'Unlike generic practice',
      missingEvidence: ['proof'],
      engine: 'semantic',
    },
  }, {
    evidence: {
      model: 'test/evidence',
      generate: async (request) => {
        assert.equal(request.language, 'en-US');
        return {
          output: {
            reasoning: 'A different exact span supplies the mechanism, while proof remains absent.',
            verdict: 'partial',
            citedSpan: 'our mechanism maps every claim to an exact rubric criterion',
            missingEvidence: ['proof'],
          },
          modelId: 'test/evidence',
        };
      },
    },
    question: {
      model: 'test/question',
      generate: async () => ({
        output: {
          challengedClaim: 'proof',
          basis: 'missing-evidence',
          sourceDocumentId: null,
        },
        modelId: 'test/question',
      }),
    },
  });

  assert.equal(response.mode, 'semantic');
  assert.equal(response.judgment.engine, 'semantic');
  assert.notEqual(response.judgment.citedSpan, 'Unlike generic practice');
  assert.equal(response.questionTargetCriterionId, CRITERION.id);
  assert.match(response.questionText, /explicit evidence.*proof/iu);
});

test('A-4 stateless defense grounds its structured verdict in the answer alone', async () => {
  const answerText = 'Our proof is a repeated student comparison against the same rubric.';
  const response = await evaluateStatelessDefense({
    answerText,
    criterion: CRITERION,
    language: 'en-US',
  }, {
    model: 'test/defense',
    generate: async (request) => {
      assert.equal(request.language, 'en-US');
      return {
        output: {
          reasoning: 'The answer explicitly states proof and the comparison behind it.',
          verdict: 'supported',
          citedSpan: answerText,
          missingEvidence: [],
        },
        modelId: 'test/defense',
      };
    },
  });

  assert.equal(response.judgment.engine, 'semantic');
  assert.equal(response.judgment.verdict, 'supported');
  assert.equal(response.judgment.citedSpan, answerText);
});

test('stateless review contracts default semantic re-judging and defense to Indonesian', async () => {
  const transcript = 'Mekanisme kami memetakan setiap klaim ke rubrik, tetapi buktinya belum lengkap.';
  const rejudgeInput = StatelessRejudgeRequestSchema.parse({
    transcript,
    criterion: CRITERION,
    rejected: {
      verdict: 'partial',
      coverageScore: 0.5,
      citedSpan: 'Mekanisme kami memetakan setiap klaim ke rubrik',
      missingEvidence: ['bukti'],
      engine: 'semantic',
    },
  });
  let rejudgeLanguage;
  await rejudgeStatelessEvidence(rejudgeInput, {
    evidence: {
      model: 'test/evidence',
      generate: async (request) => {
        rejudgeLanguage = request.language;
        return {
          output: {
            reasoning: 'Tidak ada kutipan lain yang mendukung kriteria.',
            verdict: 'unsupported',
            citedSpan: null,
            missingEvidence: ['bukti perbandingan yang dapat diperiksa'],
          },
          modelId: 'test/evidence',
        };
      },
    },
  });

  const answerText = 'Bukti kami berasal dari perbandingan mahasiswa dengan rubrik yang sama.';
  const defenseInput = StatelessDefenseRequestSchema.parse({ answerText, criterion: CRITERION });
  let defenseLanguage;
  await evaluateStatelessDefense(defenseInput, {
    model: 'test/defense',
    generate: async (request) => {
      defenseLanguage = request.language;
      return {
        output: {
          reasoning: 'Jawaban menyebutkan bukti dan perbandingan.',
          verdict: 'supported',
          citedSpan: answerText,
          missingEvidence: [],
        },
        modelId: 'test/defense',
      };
    },
  });

  assert.equal(rejudgeInput.language, 'id-ID');
  assert.equal(rejudgeLanguage, 'id-ID');
  assert.equal(defenseInput.language, 'id-ID');
  assert.equal(defenseLanguage, 'id-ID');
});

test('INV-3 stateless rejection rejects a supported verdict that also claims missing evidence', () => {
  const parsed = StatelessRejudgeRequestSchema.safeParse({
    transcript: 'The transcript contains an explicit mechanism.',
    criterion: CRITERION,
    rejected: {
      verdict: 'supported',
      coverageScore: 1,
      citedSpan: 'an explicit mechanism',
      missingEvidence: ['proof'],
      engine: 'semantic',
    },
  });

  assert.equal(parsed.success, false);
});
