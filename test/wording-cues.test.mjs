import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findWordingCues,
  summarizeWordingCues,
} from '../apps/web/lib/rehearsal/wording-cues.ts';

test('W-1 Indonesian vague quantities and hedges are found with their positions', () => {
  const matches = findWordingCues('Kayaknya banyak mahasiswa yang cukup terbantu.');
  assert.deepEqual(
    matches.map((match) => `${match.kind}:${match.label}`),
    ['hedge:kayaknya', 'vague-quantity:banyak', 'vague-quantity:cukup'],
  );
  assert.deepEqual(matches[0].tokenIndexes, [0]);
});

test('W-1 a two-word cue is counted once and consumes both tokens', () => {
  const matches = findWordingCues('Hampir semua responden setuju, kira kira sembilan puluh persen.');
  assert.deepEqual(matches.map((match) => match.label), ['hampir semua', 'kira-kira']);
  assert.deepEqual(matches[0].tokenIndexes, [0, 1]);
});

test('W-2 the summary aggregates counts and carries the invited question', () => {
  const summaries = summarizeWordingCues(
    'Banyak yang pakai, banyak yang suka, mungkin nanti banyak lagi.',
  );
  const banyak = summaries.find((summary) => summary.label === 'banyak');
  assert.equal(banyak.count, 3);
  assert.equal(banyak.invites, 'Berapa tepatnya?');
  assert.equal(summaries.find((summary) => summary.label === 'mungkin').kind, 'hedge');
  assert.equal(summaries[0].label, 'banyak', 'the most frequent cue is reported first');
});

test('W-2 a transcript with real numbers produces no cues', () => {
  assert.deepEqual(
    summarizeWordingCues('Kami menguji 40 mahasiswa dan 32 menyelesaikan latihan sampai akhir.'),
    [],
  );
});

test('W-3 invited questions follow the project language, not the cue token', () => {
  assert.equal(
    summarizeWordingCues('Many students joined.', 'id-ID')[0].invites,
    'Berapa tepatnya?',
  );
  assert.equal(
    summarizeWordingCues('Banyak mahasiswa bergabung.', 'en-US')[0].invites,
    'How many exactly?',
  );
});
