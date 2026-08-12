import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendLocalEvidenceConfirmation,
  LOCAL_EVIDENCE_CONFIRMATIONS_KEY,
  parseLocalEvidenceConfirmations,
  rejudgeLocalEvidence,
} from '../apps/web/lib/evidence-confirmations.ts';

const CONFIRMATION = {
  id: 'confirmation-1',
  reviewId: 'review-1',
  criterionId: 'differentiation',
  criterionName: 'Differentiation',
  accepted: false,
  judgedVerdict: 'supported',
  judgedCoverageScore: 1,
  judgedCitedSpan: 'Our rubric creates traceable evidence.',
  judgedMissingEvidence: [],
  judgedEngine: 'deterministic',
  createdAt: '2026-08-12T08:00:00.000Z',
  rejudgedAt: '2026-08-12T08:00:00.000Z',
};

test('A-5 keeps local evaluation labels durable, validated, and one-per-review criterion', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  appendLocalEvidenceConfirmation(storage, CONFIRMATION);
  appendLocalEvidenceConfirmation(storage, { ...CONFIRMATION, id: 'confirmation-duplicate' });

  const saved = parseLocalEvidenceConfirmations(values.get(LOCAL_EVIDENCE_CONFIRMATIONS_KEY));
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], CONFIRMATION);
  assert.deepEqual(parseLocalEvidenceConfirmations('[{"accepted":"no"}]'), []);
});

test('A-5 local rejection re-checks once without returning the rejected sentence', () => {
  const criterion = {
    id: 'differentiation',
    label: 'Differentiation',
    requirementText: 'rubric, traceable',
    signals: ['rubric', 'traceable'],
    score: 100,
    status: 'covered',
    matchedSignals: ['rubric', 'traceable'],
    missingSignals: [],
    excerpt: 'Our rubric creates traceable evidence.',
  };
  const result = rejudgeLocalEvidence(
    'Our rubric creates traceable evidence. A second rubric workflow is also traceable.',
    criterion,
    60,
  );

  assert.equal(result.criterion.status, 'covered');
  assert.equal(result.criterion.excerpt, 'A second rubric workflow is also traceable.');
  assert.notEqual(result.criterion.excerpt, criterion.excerpt);
});
