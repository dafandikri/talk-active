import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAIM_COACH_SYSTEM_PROMPT,
  ClaimCoachUnavailableError,
  coachCriteria,
  coachCriterion,
  buildClaimCoachPrompt,
  fabricatedNumbers,
} from '../apps/web/lib/ai/claim-coach.ts';
import { ClaimCoachRequestSchema } from '../apps/web/lib/contracts.ts';

const TRANSCRIPT = 'Kami sudah menguji Talk-Active ke 40 mahasiswa Fasilkom. '
  + 'Hampir semua terbantu karena rubrik menjadi latihan yang bisa dijalankan. '
  + 'Latihan sendirian tidak ada yang mengoreksi, jadi mahasiswa berhenti berlatih.';

const CRITERION = {
  id: 'c-validation',
  rubricId: 'r1',
  name: 'Validasi kebutuhan',
  description: 'Ada bukti kebutuhan nyata.',
  requiredEvidence: ['jumlah pengguna yang diuji'],
  displayOrder: 0,
};

const CLEAN_OUTPUT = {
  claims: [
    {
      citedSpan: 'Hampir semua terbantu',
      supported: false,
      supportSpan: null,
      invitedQuestion: 'Hampir semua itu berapa dari 40?',
    },
    {
      citedSpan: 'mahasiswa berhenti berlatih',
      supported: true,
      supportSpan: 'Latihan sendirian tidak ada yang mengoreksi',
      invitedQuestion: null,
    },
  ],
  strongerForm: 'Kami menguji ke 40 mahasiswa Fasilkom; ____ di antaranya terbantu.',
  blanks: ['Jumlah mahasiswa yang benar-benar terbantu, dari 40.'],
};

test('C-1 a grounded reading passes through with its claims and stronger form intact', async () => {
  const coaching = await coachCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/model',
    fallbackModels: [],
    generate: async () => ({ output: CLEAN_OUTPUT, modelId: 'test/model' }),
  });
  assert.equal(coaching.criterionId, 'c-validation');
  assert.equal(coaching.claims.length, 2);
  assert.equal(coaching.discardedClaims, 0);
  assert.equal(coaching.degradedReason, null);
  assert.ok(coaching.strongerForm.includes('____'));
  assert.equal(coaching.blanks.length, 1);
  for (const claim of coaching.claims) {
    assert.ok(TRANSCRIPT.includes(claim.citedSpan), 'every claim quote must be verbatim');
    if (claim.supportSpan !== null) assert.ok(TRANSCRIPT.includes(claim.supportSpan));
  }
});

test('C-2 an ungrounded quote is corrected once, then dropped and counted', async () => {
  const corrections = [];
  const fabricated = {
    ...CLEAN_OUTPUT,
    claims: [
      ...CLEAN_OUTPUT.claims,
      {
        citedSpan: 'kami sudah divalidasi dua ratus pengguna berbayar',
        supported: false,
        supportSpan: null,
        invitedQuestion: 'Dari mana angka itu?',
      },
    ],
  };
  const coaching = await coachCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/model',
    fallbackModels: [],
    generate: async ({ correction }) => {
      corrections.push(correction);
      return { output: fabricated, modelId: 'test/model' };
    },
  });
  assert.equal(corrections.length, 2, 'a grounding failure earns exactly one corrective retry');
  assert.equal(corrections[0], null);
  assert.match(corrections[1], /hard negatives/u);
  assert.equal(coaching.claims.length, 2, 'only verbatim claims survive');
  assert.equal(coaching.discardedClaims, 1);
  assert.match(coaching.degradedReason, /not verbatim/u);
});

test('C-3 a stronger form that invents a number is withheld, not repaired', async () => {
  const inventing = {
    ...CLEAN_OUTPUT,
    strongerForm: 'Kami menguji ke 40 mahasiswa dan 200 pengguna aktif memakai produk ini.',
    blanks: [],
  };
  const coaching = await coachCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/model',
    fallbackModels: [],
    generate: async () => ({ output: inventing, modelId: 'test/model' }),
  });
  assert.equal(coaching.strongerForm, null, 'a fabricated number kills the whole draft');
  assert.deepEqual(coaching.blanks, []);
  assert.match(coaching.degradedReason, /numbers absent from the transcript: 200/u);
  assert.equal(coaching.claims.length, 2, 'grounded claims still survive the withheld draft');
});

test('C-3 a corrected second attempt is accepted in full', async () => {
  const outputs = [
    { ...CLEAN_OUTPUT, strongerForm: 'Retensi kami 85 persen.', blanks: [] },
    CLEAN_OUTPUT,
  ];
  const coaching = await coachCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/model',
    fallbackModels: [],
    generate: async () => ({ output: outputs.shift(), modelId: 'test/model' }),
  });
  assert.notEqual(coaching.strongerForm, null);
  assert.equal(coaching.degradedReason, null);
});

test('C-4 an empty claims array is a valid finding, not an error', async () => {
  const coaching = await coachCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/model',
    fallbackModels: [],
    generate: async () => ({
      output: { claims: [], strongerForm: 'Sebutkan ____ pengguna yang diuji.', blanks: ['Jumlah pengguna.'] },
      modelId: 'test/model',
    }),
  });
  assert.deepEqual(coaching.claims, []);
  assert.equal(coaching.degradedReason, null);
});

test('C-5 a provider failure degrades this criterion alone and says so', async () => {
  const coaching = await coachCriterion(TRANSCRIPT, CRITERION, {
    model: 'test/model',
    fallbackModels: [],
    generate: async () => { throw new Error('gateway exploded'); },
  });
  assert.deepEqual(coaching.claims, []);
  assert.equal(coaching.strongerForm, null);
  assert.match(coaching.degradedReason, /unavailable/u);
  assert.match(coaching.degradedReason, /gateway exploded/u);
});

test('C-6 no configured model is a typed unavailability, never a silent guess', async () => {
  await assert.rejects(
    coachCriterion(TRANSCRIPT, CRITERION, { model: '' }),
    ClaimCoachUnavailableError,
  );
});

test('C-7 every criterion is coached, and one failure does not take the rest down', async () => {
  const criteria = [
    CRITERION,
    { ...CRITERION, id: 'c-problem', name: 'Masalah', displayOrder: 1 },
    { ...CRITERION, id: 'c-tech', name: 'Teknis', displayOrder: 2 },
  ];
  const coachings = await coachCriteria(TRANSCRIPT, criteria, {
    model: 'test/model',
    fallbackModels: [],
    generate: async ({ criterion }) => {
      if (criterion.id === 'c-problem') throw new Error('one criterion failed');
      return { output: CLEAN_OUTPUT, modelId: 'test/model' };
    },
  });
  assert.deepEqual(coachings.map((item) => item.criterionId), ['c-validation', 'c-problem', 'c-tech']);
  assert.equal(coachings[0].claims.length, 2);
  assert.equal(coachings[1].claims.length, 0);
  assert.match(coachings[1].degradedReason, /unavailable/u);
  assert.equal(coachings[2].claims.length, 2);
});

test('C-8 fabricatedNumbers ignores grouping separators and finds only new digits', () => {
  const transcript = 'Kami melatih 1.200 sesi dengan 40 mahasiswa.';
  assert.deepEqual(fabricatedNumbers('Total 1200 sesi untuk 40 orang.', transcript), []);
  assert.deepEqual(fabricatedNumbers('Retensi kami 85 persen.', transcript), ['85']);
});

// The stronger form is a script the student reads back out loud. An Indonesian
// speaker handed an English one cannot use it, which makes the language a
// correctness property of this unit rather than a presentation detail.
test('the coach is told which language to draft every generated coaching line in', () => {
  const indonesian = buildClaimCoachPrompt(TRANSCRIPT, CRITERION, null, 'id-ID');
  const english = buildClaimCoachPrompt(TRANSCRIPT, CRITERION, null, 'en-US');
  assert.match(indonesian, /Write invitedQuestion, strongerForm, and every blanks entry in Indonesian/u);
  assert.match(english, /Write invitedQuestion, strongerForm, and every blanks entry in English/u);
  assert.match(
    CLAIM_COACH_SYSTEM_PROMPT,
    /Write invitedQuestion, strongerForm, and every blanks entry in the language named by the LANGUAGE POLICY/u,
  );
  // Quoted spans are exempt on both branches: translating one would break the
  // exact-span check that findGroundedSpan enforces afterwards.
  for (const prompt of [indonesian, english]) {
    assert.match(prompt, /citedSpan and supportSpan are copied from the transcript and are never translated/u);
  }
});

test('an unset coach language defaults to Indonesian, like the project contract', () => {
  assert.match(
    buildClaimCoachPrompt(TRANSCRIPT, CRITERION, null),
    /Write invitedQuestion, strongerForm, and every blanks entry in Indonesian/u,
  );
  assert.equal(
    ClaimCoachRequestSchema.parse({
      transcript: TRANSCRIPT,
      criteria: [{
        id: CRITERION.id,
        name: CRITERION.name,
        description: CRITERION.description,
        requiredEvidence: CRITERION.requiredEvidence,
        displayOrder: 0,
      }],
    }).language,
    'id-ID',
  );
});
