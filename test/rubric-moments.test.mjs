import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRubricTimeline,
  entriesBeyondLimit,
  segmentTranscript,
  summarizeRubricCoverage,
} from '../apps/web/lib/rehearsal/rubric-moments.ts';

const TRANSCRIPT = 'Kami memulai dari masalah nyata mahasiswa Fasilkom. '
  + 'Solusi kami mengubah rubrik menjadi latihan yang bisa dijalankan. '
  + 'Terima kasih atas waktunya.';

test('R-1 a grounded citation is located as offsets that slice back to itself', () => {
  const [entry] = buildRubricTimeline(
    [{ id: 'c1', label: 'Solusi', citedSpan: 'Solusi kami mengubah rubrik' }],
    TRANSCRIPT,
  );
  assert.equal(entry.state, 'found');
  assert.equal(
    TRANSCRIPT.slice(entry.evidence.charStart, entry.evidence.charEnd),
    entry.evidence.span,
  );
  assert.equal(entry.evidence.startMs, null, 'a typed transcript carries no clock position');
});

test('R-1 an uncovered criterion stays on the list as an absent entry', () => {
  const entries = buildRubricTimeline(
    [
      { id: 'c1', label: 'Masalah', citedSpan: 'masalah nyata mahasiswa' },
      { id: 'c2', label: 'Validasi', citedSpan: null },
      { id: 'c3', label: 'Karangan', citedSpan: 'kami sudah diuji 200 pengguna berbayar' },
    ],
    TRANSCRIPT,
  );
  assert.deepEqual(entries.map((entry) => entry.state), ['found', 'absent', 'absent']);
  assert.equal(entries[2].evidence, null, 'an ungrounded span must never be located');
});

test('R-1 a reused citation keeps the review screen vocabulary', () => {
  const [entry] = buildRubricTimeline(
    [{ id: 'c1', label: 'Solusi', citedSpan: 'Solusi kami mengubah rubrik', reused: true }],
    TRANSCRIPT,
  );
  assert.equal(entry.state, 'reused');
  assert.notEqual(entry.evidence, null, 'a reused citation is still located');
});

test('R-1 dictation points put a citation on the clock', () => {
  const points = [
    { charCount: 51, atMs: 12_000 },
    { charCount: TRANSCRIPT.length, atMs: 40_000 },
  ];
  const [entry] = buildRubricTimeline(
    [{ id: 'c1', label: 'Solusi', citedSpan: 'Solusi kami mengubah rubrik' }],
    TRANSCRIPT,
    points,
  );
  assert.ok(entry.evidence.startMs >= 12_000 && entry.evidence.startMs <= 40_000);
  assert.ok(entry.evidence.endMs >= entry.evidence.startMs);
});

test('R-2 segmenting reassembles the exact transcript', () => {
  const entries = buildRubricTimeline(
    [
      { id: 'c1', label: 'Masalah', citedSpan: 'masalah nyata mahasiswa' },
      { id: 'c2', label: 'Solusi', citedSpan: 'Solusi kami mengubah rubrik' },
    ],
    TRANSCRIPT,
  );
  const segments = segmentTranscript(TRANSCRIPT, entries);
  assert.equal(segments.map((segment) => segment.text).join(''), TRANSCRIPT);
  assert.equal(segments.filter((segment) => segment.labels.length > 0).length, 2);
});

test('R-2 one span doing two jobs becomes one segment with both labels', () => {
  const transcript = 'Alpha beta gamma delta epsilon.';
  const entries = [
    { criterionId: 'c1', label: 'One', state: 'found', evidence: { span: 'beta gamma', charStart: 6, charEnd: 16, startMs: 1_000, endMs: 2_000 } },
    { criterionId: 'c2', label: 'Two', state: 'found', evidence: { span: 'gamma delta', charStart: 11, charEnd: 22, startMs: null, endMs: null } },
  ];
  const segments = segmentTranscript(transcript, entries);
  assert.equal(segments.map((segment) => segment.text).join(''), transcript);
  const marked = segments.filter((segment) => segment.labels.length > 0);
  assert.equal(marked.length, 1);
  assert.deepEqual(marked[0].labels, ['One', 'Two']);
  assert.equal(marked[0].text, 'beta gamma delta');
  assert.equal(marked[0].startMs, 1_000);
});

test('R-2 a transcript with no located evidence is one plain segment', () => {
  const segments = segmentTranscript('Just words.', [
    { criterionId: 'c1', label: 'Empty', state: 'absent', evidence: null },
  ]);
  assert.deepEqual(segments, [{ text: 'Just words.', labels: [], startMs: null }]);
});

test('R-3 only timed evidence can be reported as falling past the bell', () => {
  const entries = [
    { criterionId: 'c1', label: 'Early', state: 'found', evidence: { span: 'a', charStart: 0, charEnd: 5, startMs: 1_000, endMs: 2_000 } },
    { criterionId: 'c2', label: 'Late', state: 'found', evidence: { span: 'b', charStart: 6, charEnd: 12, startMs: 9_000, endMs: 9_500 } },
    { criterionId: 'c3', label: 'Untimed', state: 'found', evidence: { span: 'c', charStart: 13, charEnd: 20, startMs: null, endMs: null } },
    { criterionId: 'c4', label: 'Missing', state: 'absent', evidence: null },
  ];
  assert.deepEqual(entriesBeyondLimit(entries, 7_000).map((entry) => entry.criterionId), ['c2']);
  assert.deepEqual(entriesBeyondLimit(entries, 0), []);
});

test('R-4 coverage counts each state and how many reached the clock', () => {
  const entries = [
    { criterionId: 'c1', label: 'A', state: 'found', evidence: { span: 'a', charStart: 0, charEnd: 5, startMs: 1_000, endMs: 2_000 } },
    { criterionId: 'c2', label: 'B', state: 'reused', evidence: { span: 'b', charStart: 6, charEnd: 12, startMs: null, endMs: null } },
    { criterionId: 'c3', label: 'C', state: 'absent', evidence: null },
  ];
  assert.deepEqual(summarizeRubricCoverage(entries), {
    total: 3, found: 1, reused: 1, absent: 1, timed: 1,
  });
});
