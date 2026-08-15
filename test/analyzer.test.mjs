import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AnalysisError,
  DEFAULT_RUBRIC,
  MAX_CRITERIA,
  MAX_RUBRIC_CHARS,
  MAX_TRANSCRIPT_CHARS,
  STARTER_DRAFT,
  analyzeSpeech,
  compareResults,
  evaluateDefense,
  makeDrill,
  makeJudgeQuestion,
  parseRubric,
  splitSentences,
  tokenize,
} from '../apps/web/lib/analyzer.ts';

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
    language: 'en-US',
  });

  assert.equal(result.criterionCount, 4);
  assert.ok(result.evidenceScore > 0 && result.evidenceScore <= 100);
  assert.ok(result.judgeQuestion.length > 30);
  assert.match(result.drill, /claim → evidence → why it matters/u);
  assert.equal(result.delivery.wordCount, tokenize(STARTER_DRAFT).length);
});

test('semantic missing-evidence sentences remain readable in the question and drill', () => {
  const criterion = {
    label: 'Differentiation',
    missingSignals: [
      'No actual rubric is shown or described',
      'No transcript example is provided',
    ],
  };

  const question = makeJudgeQuestion(criterion, 'en-US');
  const drill = makeDrill(criterion, 'en-US');

  // The wording moved when the question started being composed from a chosen
  // cue rather than a label keyword, and again when the language became the
  // project's rather than the file's. What this check is for has not moved: a
  // sentence-shaped cue has to survive into the question and the drill intact.
  // The language is now stated rather than assumed, because the default is
  // id-ID and an English assertion that relies on a default is a test that
  // will lie the next time the default moves.
  assert.match(question, /No actual rubric is shown or described/iu);
  assert.doesNotMatch(question, /make No actual/iu);
  assert.match(drill, /Evidence to add: No actual rubric/iu);
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

test('local filler detection includes common elongated hesitation spellings', () => {
  const result = analyzeSpeech({
    transcript: 'Eeh emm hmm mm ahh err, the prototype works.',
    rubricText: 'Prototype | prototype',
    durationSeconds: 12,
  });

  assert.equal(result.delivery.fillerCount, 6);
  assert.deepEqual(
    result.delivery.fillers.map((item) => item.label),
    ['eh', 'emm', 'hmm', 'mm', 'ah', 'er'],
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
    answer: 'Unlike generic competitors, Talk-Active uses unique logic that keeps every critique traceable to the active rubric and transcript.',
    criterion: pitch.weakest,
  });
  assert.equal(defense.status, 'defensible');
  assert.equal(defense.score, 100);
  assert.deepEqual(defense.missingSignals, []);
  // "unique logic" is one cue the rubric author wrote, not two the tokenizer
  // found. The answer still satisfies all of them, which is what this checks.
  assert.deepEqual(defense.matchedSignals, ['competitors', 'unique logic', 'traceable']);
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

test('paid analysis inputs have explicit prompt-cost ceilings', () => {
  assert.throws(
    () => analyzeSpeech({
      transcript: 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1),
      rubricText: DEFAULT_RUBRIC,
      durationSeconds: 90,
    }),
    (error) => error instanceof AnalysisError && error.code === 'transcript_too_long',
  );
  assert.throws(
    () => parseRubric('x'.repeat(MAX_RUBRIC_CHARS + 1)),
    (error) => error instanceof AnalysisError && error.code === 'rubric_too_long',
  );
  assert.throws(
    () => parseRubric(Array.from(
      { length: MAX_CRITERIA + 1 },
      (_, index) => `Criterion ${index + 1} | evidence`,
    ).join('\n')),
    (error) => error instanceof AnalysisError && error.code === 'too_many_criteria',
  );
});

// Dictation does not reliably emit terminal punctuation, and the Indonesian
// capture route is where that shows most. A transcript with no `.!?` used to
// collapse to a single segment, so evidenceForCriterion ranked that one segment
// for every criterion and returned the whole transcript as each one's quote.
// That is the mechanism behind issue #32, not a separate defect.
const DICTATED_WITHOUT_PUNCTUATION = 'kami membangun talk active untuk mahasiswa indonesia yang berlatih presentasi sendirian dan kami sudah menguji prototipe ini bersama dua belas mahasiswa selama tiga minggu karena umpan balik yang mereka terima selalu datang setelah nilai keluar sehingga mereka tidak pernah tahu bagian mana yang harus diperbaiki jadi kami memetakan setiap klaim ke kriteria rubrik';

test('splitSentences segments a dictated transcript that carries no terminal punctuation', () => {
  const segments = splitSentences(DICTATED_WITHOUT_PUNCTUATION);
  assert.ok(segments.length > 1, 'an unpunctuated dictated transcript must not stay one span');
});

test('every segment stays a verbatim contiguous substring of the transcript', () => {
  // INV-3: the excerpt becomes a blockquote attributed to the speaker. A
  // segment that is not a substring is a sentence we wrote for them.
  for (const segment of splitSentences(DICTATED_WITHOUT_PUNCTUATION)) {
    assert.ok(
      DICTATED_WITHOUT_PUNCTUATION.includes(segment),
      `segment is not verbatim: ${JSON.stringify(segment)}`,
    );
  }
});

test('a punctuated transcript keeps exactly the segmentation it had', () => {
  assert.deepEqual(
    splitSentences(STARTER_DRAFT),
    STARTER_DRAFT.split(/(?<=[.!?])\s+|\r?\n+/u).map((part) => part.trim()).filter(Boolean),
  );
});

test('a short unpunctuated answer is left as one utterance', () => {
  const short = 'kami menguji prototipe ini bersama dua belas mahasiswa';
  assert.deepEqual(splitSentences(short), [short]);
});

test('an unpunctuated transcript no longer gives every criterion the same quote', () => {
  const result = analyzeSpeech({
    transcript: DICTATED_WITHOUT_PUNCTUATION,
    rubricText: 'Masalah | mahasiswa, presentasi\nValidasi | prototipe, menguji',
    durationSeconds: 90,
  });
  const quoted = result.criteria.map((criterion) => criterion.excerpt).filter(Boolean);
  assert.equal(quoted.length, 2, 'both criteria should still cite a span');
  assert.notEqual(quoted[0], quoted[1], 'two criteria must not share one whole-transcript quote');
  for (const excerpt of quoted) {
    assert.ok(
      excerpt.length < DICTATED_WITHOUT_PUNCTUATION.length,
      'a quote must be a passage, not the entire transcript',
    );
  }
});

// The AI layer was built so the model selects a quote and application code
// writes the sentence the user reads. That is what makes the citation
// guarantee hold, and it is also why the visible question was English on every
// path: composeQuestion, makeJudgeQuestion and makeDrill are template
// literals, not model output. The project language governs them, not the
// language the transcript happens to be in.
const WEAK_CRITERION = {
  id: 'validasi',
  label: 'Validasi',
  requirementText: 'pengujian pengguna',
  signals: ['pengujian', 'pengguna'],
  score: 0,
  status: 'missing',
  matchedSignals: [],
  missingSignals: ['pengujian pengguna'],
  excerpt: '',
};

test('an Indonesian project gets an Indonesian judge question and drill', () => {
  const question = makeJudgeQuestion(WEAK_CRITERION, 'id-ID');
  const drill = makeDrill(WEAK_CRITERION, 'id-ID');
  assert.match(question, /^Bukti eksplisit apa yang bisa Anda tambahkan/u);
  assert.ok(question.includes('pengujian pengguna'), 'the cue must survive translation');
  assert.match(drill, /^Ulangi hanya/u);
  assert.match(drill, /klaim . bukti . mengapa itu penting/u);
});

test('an English project keeps the English wording', () => {
  assert.match(makeJudgeQuestion(WEAK_CRITERION, 'en-US'), /^What explicit evidence can you add/u);
  assert.match(makeDrill(WEAK_CRITERION, 'en-US'), /^Retry only/u);
});

test('the visible question follows the project language, not the transcript language', () => {
  const indonesian = analyzeSpeech({
    transcript: STARTER_DRAFT,
    rubricText: DEFAULT_RUBRIC,
    durationSeconds: 90,
    language: 'id-ID',
  });
  const english = analyzeSpeech({
    transcript: STARTER_DRAFT,
    rubricText: DEFAULT_RUBRIC,
    durationSeconds: 90,
    language: 'en-US',
  });
  assert.match(indonesian.judgeQuestion, /Bukti/u);
  assert.match(indonesian.drill, /Ulangi/u);
  assert.match(english.judgeQuestion, /evidence/u);
  assert.match(english.drill, /Retry/u);
});

test('an unset language falls back to the project contract default of Indonesian', () => {
  // ProjectSchema.language defaults to id-ID. An analyzer that defaulted to
  // English would disagree with the contract that creates the project.
  const result = analyzeSpeech({
    transcript: STARTER_DRAFT,
    rubricText: DEFAULT_RUBRIC,
    durationSeconds: 90,
  });
  assert.match(result.judgeQuestion, /Bukti/u);
});
