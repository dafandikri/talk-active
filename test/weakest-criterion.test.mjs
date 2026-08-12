import assert from 'node:assert/strict';
import test from 'node:test';

import { selectWeakestCriterion } from '../apps/web/lib/weakest-criterion.ts';

function candidate({ id, order, coverage, engine = 'semantic', citedSpan = null, studentOverridden = false }) {
  return {
    criterion: { id, displayOrder: order },
    verdict: {
      criterionId: id,
      coverageScore: coverage,
      citedSpan,
      engine,
      studentOverridden,
    },
  };
}

test('A-3 selects a reliable unsupported criterion ahead of an uncertain fallback', () => {
  const selected = selectWeakestCriterion([
    candidate({ id: 'deterministic-zero', order: 0, coverage: 0, engine: 'deterministic' }),
    candidate({ id: 'semantic-zero', order: 1, coverage: 0 }),
    candidate({ id: 'semantic-partial', order: 2, coverage: 0.5 }),
  ]);

  assert.equal(selected?.criterion.id, 'semantic-zero');
});

test('A-3 ranks student-rejected and citation-reused readings as uncertain', () => {
  const shared = 'Talk-Active starts from the evaluator rubric for every rehearsal.';
  const selected = selectWeakestCriterion([
    candidate({ id: 'student-rejected', order: 2, coverage: 0, studentOverridden: true }),
    candidate({ id: 'reused-a', order: 1, coverage: 1, citedSpan: shared }),
    candidate({ id: 'reused-b', order: 3, coverage: 1, citedSpan: shared }),
    candidate({ id: 'stable-partial', order: 0, coverage: 0.5 }),
  ]);

  assert.equal(selected?.criterion.id, 'stable-partial');
});

test('A-3 uses rubric display order only after the selection score ties', () => {
  const selected = selectWeakestCriterion([
    candidate({ id: 'later', order: 4, coverage: 0.5 }),
    candidate({ id: 'earlier', order: 1, coverage: 0.5 }),
  ]);

  assert.equal(selected?.criterion.id, 'earlier');
});
