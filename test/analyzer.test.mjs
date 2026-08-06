import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AnalysisError,
  DEFAULT_RUBRIC,
  STARTER_DRAFT,
  analyzeSpeech,
  compareResults,
  evaluateDefense,
  parseRubric,
  tokenize,
} from '../src/analyzer.mjs';

test('parseRubric converts discussion syntax into evidence criteria', () => {
  const rubric = parseRubric('Problem clarity | students, evidence, urgency\nFeasibility | prototype, privacy');
  assert.equal(rubric.length, 2);
  assert.deepEqual(rubric[0].signals, ['students', 'evidence', 'urgency']);
  assert.equal(rubric[1].id, 'feasibility');
});

test('analyzeSpeech produces an evidence map and a focused next action', () => {
  const result = analyzeSpeech({
    transcript: STARTER_DRAFT,
    rubricText: DEFAULT_RUBRIC,
    durationSeconds: 90,
  });

  assert.equal(result.criterionCount, 4);
  assert.ok(result.evidenceScore > 0 && result.evidenceScore <= 100);
  assert.ok(result.judgeQuestion.length > 30);
  assert.match(result.drill, /claim → evidence → why it matters/u);
  assert.equal(result.delivery.wordCount, tokenize(STARTER_DRAFT).length);
});

test('local filler detection includes Indonesian and English cues', () => {
  const result = analyzeSpeech({
    transcript: 'Um, apa ya, kayak this is basically anu, a prototype gitu.',
    rubricText: 'Prototype | prototype',
    durationSeconds: 15,
  });

  assert.equal(result.delivery.fillerCount, 6);
  assert.deepEqual(
    result.delivery.fillers.map((item) => item.label),
    ['um', 'anu', 'kayak', 'gitu', 'apa ya', 'basically'],
  );
});

test('compareResults reports improvement without inventing a judgment', () => {
  const baseline = analyzeSpeech({
    transcript: 'Students have a problem.',
    rubricText: 'Problem | students, evidence\nSolution | rubric, retry',
    durationSeconds: 20,
  });
  const current = analyzeSpeech({
    transcript: 'Students have a problem. Survey evidence shows it. The rubric guides one retry.',
    rubricText: 'Problem | students, evidence\nSolution | rubric, retry',
    durationSeconds: 20,
  });
  const delta = compareResults(baseline, current);

  assert.ok(delta.evidenceDelta > 0);
  assert.ok(delta.coveredDelta > 0);
});

test('judge-room defense is grounded in the weakest criterion signals', () => {
  const pitch = analyzeSpeech({
    transcript: STARTER_DRAFT,
    rubricText: DEFAULT_RUBRIC,
    durationSeconds: 50,
  });
  assert.equal(pitch.weakest.label, 'Differentiation');

  const defense = evaluateDefense({
    answer: 'Unlike generic competitors, Lancar uses unique logic that keeps every critique traceable to the active rubric and transcript.',
    criterion: pitch.weakest,
  });
  assert.equal(defense.status, 'defensible');
  assert.equal(defense.score, 100);
  assert.deepEqual(defense.missingSignals, []);
  assert.deepEqual(defense.matchedSignals, ['competitors', 'unique', 'logic', 'traceable']);
  assert.match(defense.followUp, /user evidence/u);
});

test('judge-room defense exposes what a developing answer still leaves implicit', () => {
  const criterion = {
    id: 'differentiation',
    label: 'Differentiation',
    signals: ['competitors', 'unique', 'logic', 'traceable'],
  };
  const defense = evaluateDefense({
    answer: 'Unlike competitors, our approach is unique.',
    criterion,
  });

  assert.equal(defense.status, 'developing');
  assert.equal(defense.score, 50);
  assert.deepEqual(defense.missingSignals, ['logic', 'traceable']);
  assert.match(defense.feedback, /still leaves logic and traceable implicit/u);
});

test('invalid analysis inputs fail with actionable typed errors', () => {
  assert.throws(
    () => analyzeSpeech({ transcript: '', rubricText: DEFAULT_RUBRIC, durationSeconds: 90 }),
    (error) => error instanceof AnalysisError && error.code === 'empty_transcript',
  );
  assert.throws(
    () => analyzeSpeech({ transcript: 'Hello', rubricText: '', durationSeconds: 90 }),
    (error) => error instanceof AnalysisError && error.code === 'empty_rubric',
  );
  assert.throws(
    () => analyzeSpeech({ transcript: 'Hello', rubricText: 'Clarity', durationSeconds: 0 }),
    (error) => error instanceof AnalysisError && error.code === 'invalid_duration',
  );
  assert.throws(
    () => evaluateDefense({ answer: '', criterion: { signals: ['proof'] } }),
    (error) => error instanceof AnalysisError && error.code === 'empty_answer',
  );
  assert.throws(
    () => evaluateDefense({ answer: 'An answer', criterion: null }),
    (error) => error instanceof AnalysisError && error.code === 'invalid_criterion',
  );
});
