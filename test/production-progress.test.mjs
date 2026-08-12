import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { AttemptComparisonSchema, RecurringWeaknessSchema } from '../apps/web/lib/contracts.ts';
import {
  compareAttemptEvidence,
  parseSavedSessions,
  summarizeRecurringWeaknesses,
} from '../apps/web/lib/progress.ts';

const OLD_SESSION = {
  id: 'old-1',
  createdAt: '2026-08-10T08:00:00.000Z',
  evidenceScore: 40,
  weakest: 'Differentiation',
  defenseStatus: null,
};

function detailedSession({ id, createdAt, feasibilityCoverage, feasibilitySpan = null }) {
  return {
    id,
    createdAt,
    evidenceScore: Math.round(feasibilityCoverage * 100),
    weakest: 'Feasibility',
    defenseStatus: null,
    projectId: null,
    criteria: [{
      criterionId: 'criterion-feasibility',
      criterionName: 'Feasibility',
      verdict: feasibilityCoverage === 1 ? 'supported' : feasibilityCoverage === 0 ? 'unsupported' : 'partial',
      coverage: feasibilityCoverage,
      citedSpan: feasibilitySpan,
      missingEvidence: feasibilityCoverage === 1 ? [] : ['timeline', 'cost'],
    }, {
      criterionId: 'criterion-problem',
      criterionName: 'Problem clarity',
      verdict: 'supported',
      coverage: 1,
      citedSpan: 'Students currently rehearse without evaluator-specific feedback.',
      missingEvidence: [],
    }],
  };
}

test('F-4 reads old summary sessions without inventing criterion evidence', () => {
  const [session] = parseSavedSessions(JSON.stringify([OLD_SESSION, { broken: true }]));
  assert.ok(session);
  assert.equal(session.projectId, null);
  assert.deepEqual(session.criteria, []);

  assert.deepEqual(summarizeRecurringWeaknesses([session]), [], 'one gap is not yet recurring');
  const [weakness] = summarizeRecurringWeaknesses([
    session,
    { ...session, id: 'old-2', createdAt: '2026-08-11T08:00:00.000Z' },
  ]);
  assert.equal(weakness.summaryOnly, true);
  assert.equal(weakness.attemptCount, 2);
  assert.equal(weakness.averageCoverage, null);
  assert.equal(weakness.latestCitedSpan, null);
  assert.deepEqual(weakness.latestMissingEvidence, []);
});

test('F-4 ranks recurring criterion gaps and retains latest traceable evidence', () => {
  const sessions = parseSavedSessions(JSON.stringify([
    detailedSession({
      id: 'attempt-1',
      createdAt: '2026-08-11T08:00:00.000Z',
      feasibilityCoverage: 0,
    }),
    detailedSession({
      id: 'attempt-2',
      createdAt: '2026-08-12T08:00:00.000Z',
      feasibilityCoverage: 0.5,
      feasibilitySpan: 'The implementation uses a deterministic fallback.',
    }),
  ]));
  const weaknesses = summarizeRecurringWeaknesses(sessions);

  assert.equal(weaknesses.length, 1, 'fully covered criteria are not mislabeled as recurring weaknesses');
  assert.equal(weaknesses[0].criterionName, 'Feasibility');
  assert.equal(weaknesses[0].attemptCount, 2);
  assert.equal(weaknesses[0].gapCount, 2);
  assert.equal(weaknesses[0].averageCoverage, 0.25);
  assert.equal(weaknesses[0].latestCitedSpan, 'The implementation uses a deterministic fallback.');
  assert.deepEqual(weaknesses[0].latestMissingEvidence, ['timeline', 'cost']);
});

test('F-4 contract rejects a synced weakness with no citation or explicit gap', () => {
  const result = RecurringWeaknessSchema.safeParse({
    criterionId: 'criterion-1',
    criterionName: 'Feasibility',
    attemptCount: 2,
    gapCount: 1,
    averageCoverage: 0.75,
    latestAttemptId: 'attempt-2',
    latestAt: '2026-08-12T08:00:00.000Z',
    latestCitedSpan: null,
    latestMissingEvidence: [],
    summaryOnly: false,
  });
  assert.equal(result.success, false);
});

test('F-3 compares adjacent attempts with exact evidence retained on both sides', () => {
  const comparisons = compareAttemptEvidence([
    detailedSession({
      id: 'attempt-1',
      createdAt: '2026-08-11T08:00:00.000Z',
      feasibilityCoverage: 0,
    }),
    detailedSession({
      id: 'attempt-2',
      createdAt: '2026-08-12T08:00:00.000Z',
      feasibilityCoverage: 0.5,
      feasibilitySpan: 'The implementation uses a deterministic fallback.',
    }),
  ]);
  assert.equal(comparisons.length, 1);
  const comparison = comparisons[0];
  assert.equal(comparison.previousAttemptId, 'attempt-1');
  assert.equal(comparison.currentAttemptId, 'attempt-2');
  const feasibility = comparison.criteria.find((item) => item.criterionId === 'criterion-feasibility');
  assert.equal(feasibility.direction, 'improved');
  assert.equal(feasibility.coverageDelta, 0.5);
  assert.equal(feasibility.previous.citedSpan, null);
  assert.deepEqual(feasibility.previous.missingEvidence, ['timeline', 'cost']);
  assert.equal(feasibility.current.citedSpan, 'The implementation uses a deterministic fallback.');
  assert.deepEqual(feasibility.current.missingEvidence, ['timeline', 'cost']);
});

test('F-3 skips summary-only history and labels rubric criterion changes explicitly', () => {
  const first = detailedSession({
    id: 'attempt-1', createdAt: '2026-08-11T08:00:00.000Z', feasibilityCoverage: 0,
  });
  first.criteria = first.criteria.filter((item) => item.criterionId !== 'criterion-problem');
  const second = detailedSession({
    id: 'attempt-2', createdAt: '2026-08-12T08:00:00.000Z', feasibilityCoverage: 0,
  });
  second.criteria = second.criteria.filter((item) => item.criterionId !== 'criterion-feasibility');
  const [comparison] = compareAttemptEvidence([{ ...OLD_SESSION, projectId: null, criteria: [] }, second, first]);
  assert.equal(comparison.previousAttemptId, 'attempt-1');
  assert.equal(comparison.currentAttemptId, 'attempt-2');
  assert.equal(comparison.criteria.find((item) => item.criterionId === 'criterion-feasibility').direction, 'removed');
  assert.equal(comparison.criteria.find((item) => item.criterionId === 'criterion-problem').direction, 'added');
});

test('F-3 never compares attempts belonging to different projects', () => {
  const first = detailedSession({
    id: 'attempt-project-a', createdAt: '2026-08-10T08:00:00.000Z', feasibilityCoverage: 0,
  });
  const second = detailedSession({
    id: 'attempt-project-b', createdAt: '2026-08-11T08:00:00.000Z', feasibilityCoverage: 0,
  });
  assert.deepEqual(compareAttemptEvidence([
    { ...first, projectId: 'project-a' },
    { ...second, projectId: 'project-b' },
  ]), []);
});

test('F-3 contract rejects invented movement disconnected from retained coverage', () => {
  const result = AttemptComparisonSchema.safeParse({
    previousAttemptId: 'attempt-1',
    previousCreatedAt: '2026-08-11T08:00:00.000Z',
    currentAttemptId: 'attempt-2',
    currentCreatedAt: '2026-08-12T08:00:00.000Z',
    criteria: [{
      criterionId: 'criterion-feasibility',
      criterionName: 'Feasibility',
      previous: detailedSession({ id: 'one', createdAt: '2026-08-11T08:00:00.000Z', feasibilityCoverage: 0 }).criteria[0],
      current: detailedSession({ id: 'two', createdAt: '2026-08-12T08:00:00.000Z', feasibilityCoverage: 0.5, feasibilitySpan: 'The implementation uses a deterministic fallback.' }).criteria[0],
      coverageDelta: 1,
      direction: 'regressed',
    }],
  });
  assert.equal(result.success, false);
});

test('F-4 SQL groups by criterion, excludes empty attempts, and never calls a model', async () => {
  const source = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  const progressSource = source.slice(source.indexOf('export async function getProjectProgress'));
  assert.match(progressSource, /groupBy\(criteria\.id, criteria\.name\)/u);
  assert.match(progressSource, /gapCount:[\s\S]+coverageScore[\s\S]+< 1/u);
  assert.match(progressSource, /having\([\s\S]+is not null/u);
  assert.match(progressSource, /latestEvidence/u);
  assert.match(progressSource, /criterionName: criteria\.name/u);
  assert.match(progressSource, /attemptComparisons = compareAttemptEvidence/u);
  assert.doesNotMatch(progressSource, /judgeEvidence|generateJudgeQuestion|judgeDefense/u);
});
