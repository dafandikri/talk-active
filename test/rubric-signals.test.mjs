import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeSpeech,
  DEFAULT_RUBRIC,
  evaluateDefense,
  makeJudgeQuestion,
  parseRubric,
  STARTER_DRAFT,
} from '../apps/web/lib/analyzer.ts';

// A rubric line is `Label | signal, signal, signal`. The comma is the separator
// the syntax advertises, so a signal the author wrote as two words has to
// survive as two words. Splitting it into tokens inflates the denominator every
// score divides by, and leaves fragments like "tidak" — the first half of
// "tidak seperti" — standing where a cue should be.

test('a comma-separated signal keeps its words together', () => {
  const [criterion] = parseRubric('Differentiation | unlike, competitor, existing tools, instead');

  assert.deepEqual(criterion.signals, ['unlike', 'competitor', 'existing tools', 'instead']);
});

test('the author writes the signal count, not the tokenizer', () => {
  // Four commas-separated cues must stay four, or coverage is measured against
  // a denominator the author never chose.
  const [criterion] = parseRubric('Differentiation | unlike, competitor, existing tools, instead');

  assert.equal(criterion.signals.length, 4);
});

test('an Indonesian phrase is not split into its function words', () => {
  const [criterion] = parseRubric('Diferensiasi | tidak seperti, pesaing, alat lain');

  assert.deepEqual(criterion.signals, ['tidak seperti', 'pesaing', 'alat lain']);
  assert.ok(!criterion.signals.includes('tidak'), '"tidak" is debris from splitting "tidak seperti"');
  assert.ok(!criterion.signals.includes('seperti'), '"seperti" is debris from splitting "tidak seperti"');
});

test('extra whitespace and stray separators do not become signals', () => {
  const [criterion] = parseRubric('Impact |  beneficiary ,, measurable   outcome ,  ');

  assert.deepEqual(criterion.signals, ['beneficiary', 'measurable outcome']);
});

test('a signal the author repeats is recorded once', () => {
  const [criterion] = parseRubric('Impact | beneficiary, beneficiary, scale');

  assert.deepEqual(criterion.signals, ['beneficiary', 'scale']);
});

// Signals derived from the label are our guess, not the author's words, so the
// stop-word filter still applies there.
test('a criterion with no explicit signals still derives them from its label', () => {
  const [criterion] = parseRubric('Problem clarity for the students');

  assert.ok(criterion.signals.includes('problem'));
  assert.ok(criterion.signals.includes('clarity'));
  assert.ok(!criterion.signals.includes('for'), 'a derived signal list should drop function words');
  assert.ok(!criterion.signals.includes('the'), 'a derived signal list should drop function words');
});

// Matching a phrase means every word in it is present. Counting its words
// separately is what let "existing tools" score half a point for a transcript
// that only said "tools".
test('a multi-word signal matches only when the whole phrase is present', () => {
  const rubricText = 'Differentiation | existing tools';

  const both = analyzeSpeech({
    transcript: 'We compared this against the existing tools that students already use today.',
    rubricText,
    durationSeconds: 30,
  });
  assert.deepEqual(both.criteria[0].matchedSignals, ['existing tools']);

  const half = analyzeSpeech({
    transcript: 'We compared this against the tools that students already use today.',
    rubricText,
    durationSeconds: 30,
  });
  assert.deepEqual(half.criteria[0].matchedSignals, [], 'half a phrase is not the phrase');
  assert.deepEqual(half.criteria[0].missingSignals, ['existing tools']);
});

// INV-3: the question has to point at something the user can act on. The first
// missing signal in rubric order is an arbitrary pick, and on the demo path it
// lands on "unlike".
test('the judge question asks about the most informative missing cue', () => {
  const question = makeJudgeQuestion({
    id: 'differentiation',
    label: 'Differentiation',
    requirementText: 'unlike, competitor, existing tools, instead',
    signals: ['unlike', 'competitor', 'existing tools', 'instead'],
    score: 0,
    status: 'missing',
    matchedSignals: [],
    missingSignals: ['unlike', 'competitor', 'existing tools', 'instead'],
    excerpt: '',
  });

  assert.match(question, /existing tools/);
  assert.ok(!/“unlike”/.test(question), 'a function word is not the cue worth asking about');
});

test('the judge question prefers a cue that carries meaning in Indonesian', () => {
  const question = makeJudgeQuestion({
    id: 'diferensiasi',
    label: 'Diferensiasi',
    requirementText: 'tidak seperti, pesaing, alat lain',
    signals: ['tidak seperti', 'pesaing', 'alat lain'],
    score: 0,
    status: 'missing',
    matchedSignals: [],
    missingSignals: ['tidak seperti', 'pesaing', 'alat lain'],
    excerpt: '',
  });

  assert.ok(
    !/“tidak seperti”/.test(question),
    '"tidak seperti" is entirely function words, so it cannot anchor a question',
  );
  assert.match(question, /alat lain|pesaing/);
});

test('the judge question never states a fact about the world (INV-1)', () => {
  // The previous wording asserted what competing products support. An external
  // claim shipped in product output is a claim a judge can ask us to source.
  for (const scenario of [
    'Differentiation | unlike, competitor, existing tools, instead',
    'Diferensiasi | tidak seperti, pesaing, alat lain',
    'Feasibility | implementation, local, cost, timeline',
  ]) {
    const [criterion] = parseRubric(scenario);
    const question = makeJudgeQuestion({
      ...criterion,
      score: 0,
      status: 'missing',
      matchedSignals: [],
      missingSignals: criterion.signals,
      excerpt: '',
    });

    assert.ok(
      !/already support|existing speaking coaches|competitors offer/i.test(question),
      `the question asserts something about the world: ${question}`,
    );
  }
});

// Ranking cannot rescue a set of one. When a criterion's only gap is a function
// word, there is no informative cue to rank toward, so the question has to fall
// back to the span rather than ask a student to evidence "instead".
test('a gap made only of function words does not anchor the question', () => {
  const question = makeJudgeQuestion({
    id: 'differentiation',
    label: 'Differentiation',
    requirementText: 'unlike, existing tools, instead',
    signals: ['unlike', 'existing tools', 'instead'],
    score: 67,
    status: 'covered',
    matchedSignals: ['unlike', 'existing tools'],
    missingSignals: ['instead'],
    excerpt: 'We win because the rubric drives every question we ask.',
  });

  assert.ok(!/“instead”/.test(question), 'a function word cannot anchor a question');
  assert.match(question, /rubric drives every question/);
});

test('a function-word gap with no span still produces a usable question', () => {
  const question = makeJudgeQuestion({
    id: 'differentiation',
    label: 'Differentiation',
    requirementText: 'instead',
    signals: ['instead'],
    score: 0,
    status: 'missing',
    matchedSignals: [],
    missingSignals: ['instead'],
    excerpt: '',
  });

  assert.ok(question.trim().length > 10);
  assert.match(question, /Differentiation/);
});

// Two criteria can be equally weak while only one of them tells the student
// what to do next. Rubric order is an arbitrary way to break that tie.
test('among equally weak criteria the actionable gap is coached first', () => {
  const analysis = analyzeSpeech({
    transcript: [
      'We are unlike the existing tools that students already use.',
      'Our team has shipped production software together before.',
    ].join(' '),
    rubricText: [
      'Differentiation | unlike, existing tools, instead',
      'Team | team, shipped, experience',
    ].join('\n'),
    durationSeconds: 40,
  });

  const differentiation = analysis.criteria.find(({ id }) => id === 'differentiation');
  const team = analysis.criteria.find(({ id }) => id === 'team');
  assert.equal(differentiation.score, team.score, 'this scenario is only meaningful while they tie');

  assert.equal(analysis.weakest.id, 'team', 'the gap a student can act on is the one worth coaching');
  assert.match(analysis.judgeQuestion, /experience/);
});

// A span is quoted because it is the evidence, but a runaway sentence should
// not become a runaway question.
test('a very long span is elided inside the question', () => {
  const span = `We visited ${'many different campuses across the country '.repeat(6)}this year.`;
  const question = makeJudgeQuestion({
    id: 'reach',
    label: 'Reach',
    requirementText: 'campuses',
    signals: ['campuses'],
    score: 100,
    status: 'covered',
    matchedSignals: ['campuses'],
    missingSignals: [],
    excerpt: span,
  });

  assert.ok(question.length < span.length, 'the question must not simply inline the whole span');
  assert.match(question, /…/u, 'an elided span has to show that it was elided');
});

// The evidence pass and the defense pass must agree on what a cue is. They did
// not: evidence learned to read phrases while the defense kept testing single
// tokens, so an answer that said "unique logic" was told "unique logic" was
// missing. The recorded scenarios all use one-word cues, so only a run against
// the default rubric could show it.
test('a defense answering a multi-word cue is credited with it', () => {
  const [criterion] = parseRubric('Differentiation | competitors, unique logic, traceable');

  const defense = evaluateDefense({
    answer: 'Compared with competitors, our unique logic keeps every verdict traceable to the rubric.',
    criterion,
  });

  assert.deepEqual(defense.missingSignals, []);
  assert.deepEqual(defense.matchedSignals, ['competitors', 'unique logic', 'traceable']);
  assert.equal(defense.status, 'defensible');
});

test('the shipped default rubric still reaches a defensible answer', () => {
  const analysis = analyzeSpeech({
    transcript: STARTER_DRAFT,
    rubricText: DEFAULT_RUBRIC,
    durationSeconds: 60,
  });
  const defense = evaluateDefense({
    answer: 'Compared with competitors, our unique logic keeps every verdict traceable to the evaluator rubric.',
    criterion: analysis.weakest,
  });

  assert.equal(analysis.weakest.id, 'differentiation');
  assert.equal(defense.status, 'defensible', 'the demo answer must survive a change to cue parsing');
});

test('half a phrase still does not defend the cue', () => {
  const [criterion] = parseRubric('Differentiation | competitors, unique logic, traceable');

  const defense = evaluateDefense({
    answer: 'Compared with competitors, our approach is unique and stays traceable.',
    criterion,
  });

  assert.deepEqual(defense.missingSignals, ['unique logic']);
});

test('every criterion still reports a usable question when nothing is missing', () => {
  const analysis = analyzeSpeech({
    transcript: 'The rubric defines the criterion and the criterion drives the question.',
    rubricText: 'Rubric grounding | rubric, criterion',
    durationSeconds: 25,
  });

  assert.deepEqual(analysis.criteria[0].missingSignals, []);
  assert.ok(analysis.judgeQuestion.trim().length > 10);
});
