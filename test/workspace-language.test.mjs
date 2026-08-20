import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import test from 'node:test';

// The production bundle resolves extensionless TypeScript imports. Node's
// strip-types test runner needs the same small resolution rule for this direct
// service test.
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'next/server') return nextResolve('next/server.js', context);
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (
          error?.code !== 'ERR_MODULE_NOT_FOUND'
          || !specifier.startsWith('.')
          || /\.[cm]?[jt]sx?$/u.test(specifier)
        ) {
          throw error;
        }
        return nextResolve(`${specifier}.ts`, context);
      }
    },
  });
} else {
  nodeModule.register(new URL('./fixtures/typescript-extension-loader.mjs', import.meta.url));
}

const {
  confirmAttemptEvidence,
  createAttemptQuestion,
  evaluateAttemptDefense,
  evaluateAttemptEvidence,
} = await import('../apps/web/lib/services/workspace.ts');

const CREATED_AT = '2026-08-20T04:00:00.000Z';
const PROJECT_ID = 'project-1';
const ATTEMPT_ID = 'attempt-1';
const CRITERION_ID = 'criterion-1';
const VERDICT_ID = 'verdict-1';
const TRANSCRIPT = 'Opening words. This exact claim supports the criterion. A different exact claim closes the gap.';
const INITIAL_SPAN = 'This exact claim supports the criterion.';
const REJUDGED_SPAN = 'A different exact claim closes the gap.';
const DEFENSE_SPAN = 'This exact defense answer supplies the evidence.';

const criterion = {
  id: CRITERION_ID,
  rubricId: 'rubric-1',
  name: 'Evidence quality',
  description: 'Supply concrete evidence.',
  requiredEvidence: ['customer proof'],
  displayOrder: 0,
};

const attempt = {
  id: ATTEMPT_ID,
  projectId: PROJECT_ID,
  mode: 'typed',
  status: 'draft',
  transcript: TRANSCRIPT,
  transcriptSource: 'typed',
  durationSeconds: 60,
  legacyTitle: null,
  legacyEvidenceCoverage: null,
  legacyWeakest: null,
  legacyDefenseStatus: null,
  createdAt: CREATED_AT,
  completedAt: null,
};

function project(language) {
  return {
    id: PROJECT_ID,
    userId: 'user-1',
    title: 'Project',
    language,
    eventContext: null,
    deadline: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function verdict(overrides = {}) {
  return {
    id: VERDICT_ID,
    attemptId: ATTEMPT_ID,
    criterionId: CRITERION_ID,
    stage: 'initial',
    verdict: 'partial',
    coverageScore: 0.5,
    citedSpan: INITIAL_SPAN,
    missingEvidence: ['customer proof'],
    engine: 'semantic',
    verifierAgreed: true,
    verifierNote: null,
    studentOverridden: false,
    studentOverrideVerdict: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function chainValue(calls, name) {
  return calls.find((call) => call.name === name)?.args[0];
}

/** A deliberately tiny Drizzle double: each root query consumes one scripted result. */
function scriptedDatabase(steps) {
  let cursor = 0;
  const db = {};

  function query(method) {
    const step = steps[cursor++];
    assert.ok(step, `unexpected ${method} query`);
    assert.equal(step.method, method, `expected ${step.method}, received ${method}`);
    const calls = [];
    let chain;
    chain = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          return (resolve, reject) => {
            const value = typeof step.result === 'function'
              ? step.result(calls)
              : step.result;
            return Promise.resolve(value).then(resolve, reject);
          };
        }
        return (...args) => {
          calls.push({ name: String(property), args });
          return chain;
        };
      },
    });
    return chain;
  }

  for (const method of ['select', 'insert', 'update', 'delete']) {
    db[method] = () => query(method);
  }
  db.transaction = async (callback) => callback(db);
  db.assertDone = () => assert.equal(cursor, steps.length, 'all scripted database operations ran');
  return db;
}

function evidenceOutput(citedSpan) {
  return {
    reasoning: 'The supplied passage explicitly addresses the criterion.',
    verdict: 'supported',
    citedSpan,
    missingEvidence: [],
  };
}

async function runInitialEvidence(language) {
  const seenLanguages = [];
  const db = scriptedDatabase([
    { method: 'select', result: [attempt] },
    { method: 'select', result: [project(language)] },
    { method: 'select', result: [{ criterion }] },
    { method: 'update', result: [] },
    { method: 'delete', result: [] },
    {
      method: 'insert',
      result: (calls) => chainValue(calls, 'values').map((value) => verdict({
        ...value,
        id: VERDICT_ID,
        createdAt: CREATED_AT,
      })),
    },
    { method: 'update', result: [] },
  ]);

  const response = await evaluateAttemptEvidence(db, ATTEMPT_ID, {
    model: 'test/evidence',
    generate: async (request) => {
      seenLanguages.push(request.language);
      return { output: evidenceOutput(INITIAL_SPAN), modelId: 'test/evidence' };
    },
  }, 'user-1');
  db.assertDone();
  assert.equal(response.verdicts[0].citedSpan, INITIAL_SPAN);
  return seenLanguages;
}

test('synced review paths use the persisted English project language without translating quotes', async () => {
  assert.deepEqual(await runInitialEvidence('en-US'), ['en-US']);

  const rejudgeLanguages = [];
  const rejudgeDb = scriptedDatabase([
    { method: 'select', result: [{ attempt, criterion, verdict: verdict() }] },
    { method: 'select', result: [project('en-US')] },
    { method: 'select', result: [] },
    {
      method: 'insert',
      result: [{
        id: 'confirmation-1',
        evidenceVerdictId: VERDICT_ID,
        accepted: false,
        judgedVerdict: 'partial',
        judgedCoverageScore: 0.5,
        judgedCitedSpan: INITIAL_SPAN,
        judgedMissingEvidence: ['customer proof'],
        judgedEngine: 'semantic',
        createdAt: CREATED_AT,
        rejudgedAt: null,
      }],
    },
    {
      method: 'update',
      result: (calls) => [verdict({
        ...chainValue(calls, 'set'),
        citedSpan: REJUDGED_SPAN,
      })],
    },
    {
      method: 'update',
      result: [{
        id: 'confirmation-1',
        evidenceVerdictId: VERDICT_ID,
        accepted: false,
        judgedVerdict: 'partial',
        judgedCoverageScore: 0.5,
        judgedCitedSpan: INITIAL_SPAN,
        judgedMissingEvidence: ['customer proof'],
        judgedEngine: 'semantic',
        createdAt: CREATED_AT,
        rejudgedAt: CREATED_AT,
      }],
    },
  ]);
  const rejudged = await confirmAttemptEvidence(
    rejudgeDb,
    ATTEMPT_ID,
    CRITERION_ID,
    { accepted: false },
    {
      model: 'test/evidence',
      generate: async (request) => {
        rejudgeLanguages.push(request.language);
        return { output: evidenceOutput(REJUDGED_SPAN), modelId: 'test/evidence' };
      },
    },
    'user-1',
  );
  rejudgeDb.assertDone();
  assert.deepEqual(rejudgeLanguages, ['en-US']);
  assert.equal(rejudged.verdict.citedSpan, REJUDGED_SPAN);

  const questionDb = scriptedDatabase([
    { method: 'select', result: [{ projectId: PROJECT_ID }] },
    { method: 'select', result: [project('en-US')] },
    { method: 'select', result: [{ attempt, criterion, verdict: verdict() }] },
    { method: 'select', result: [] },
    {
      method: 'insert',
      result: (calls) => [{
        id: 'question-1',
        ...chainValue(calls, 'values'),
        createdAt: CREATED_AT,
      }],
    },
    { method: 'update', result: [] },
  ]);
  const questioned = await createAttemptQuestion(questionDb, ATTEMPT_ID, {
    model: 'test/question',
    generate: async () => ({
      output: {
        challengedClaim: 'customer proof',
        basis: 'missing-evidence',
        sourceDocumentId: null,
      },
      modelId: 'test/question',
    }),
  }, 'user-1');
  questionDb.assertDone();
  assert.match(questioned.question.questionText, /^What explicit evidence can you add/u);
  assert.equal(questioned.question.challengedClaim, 'customer proof');

  const defenseLanguages = [];
  const defenseDb = scriptedDatabase([
    { method: 'select', result: [{ projectId: PROJECT_ID }] },
    { method: 'select', result: [project('en-US')] },
    {
      method: 'select',
      result: [{
        question: {
          id: 'question-1',
          attemptId: ATTEMPT_ID,
          targetCriterionId: CRITERION_ID,
          questionText: 'What evidence supports this claim?',
          challengedClaim: 'customer proof',
          basis: 'missing-evidence',
          sourceDocumentId: null,
          createdAt: CREATED_AT,
        },
        criterion,
      }],
    },
    {
      method: 'insert',
      result: (calls) => [{
        id: 'answer-1',
        ...chainValue(calls, 'values'),
        createdAt: CREATED_AT,
      }],
    },
    {
      method: 'insert',
      result: (calls) => [verdict({
        ...chainValue(calls, 'values'),
        id: 'defense-verdict-1',
        createdAt: CREATED_AT,
      })],
    },
    { method: 'update', result: [] },
  ]);
  const defended = await evaluateAttemptDefense(defenseDb, ATTEMPT_ID, {
    answerText: DEFENSE_SPAN,
  }, {
    model: 'test/defense',
    generate: async (request) => {
      defenseLanguages.push(request.language);
      return { output: evidenceOutput(DEFENSE_SPAN), modelId: 'test/defense' };
    },
  }, 'user-1');
  defenseDb.assertDone();
  assert.deepEqual(defenseLanguages, ['en-US']);
  assert.equal(defended.verdict.citedSpan, DEFENSE_SPAN);
});

test('the persisted Indonesian project language remains the default review behavior', async () => {
  assert.deepEqual(await runInitialEvidence('id-ID'), ['id-ID']);
});
