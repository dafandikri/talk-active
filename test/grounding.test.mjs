import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_SPAN_CHARS,
  findGroundedSpan,
  normaliseForGrounding,
  spanIsGrounded,
} from '../apps/web/lib/grounding.ts';

test('M-4 grounds a quote across whitespace and typographic punctuation', () => {
  const transcript = 'We reduced preparation time\nby half, and students said—clearly—it helped.';

  assert.equal(spanIsGrounded('reduced preparation time by half', transcript), true);
  assert.equal(spanIsGrounded('students said-clearly-it helped', transcript), true);
  assert.equal(
    normaliseForGrounding('Students said—clearly—it helped.'),
    'students said-clearly-it helped.',
  );
});

test('M-4 maps a normalised match back to the exact original transcript span', () => {
  const transcript = 'Opening. Students said—clearly—it helped. Closing.';
  assert.equal(
    findGroundedSpan('students said-clearly-it helped', transcript),
    'Students said—clearly—it helped',
  );
});

test('M-4 rejects fabricated and coincidentally short spans', () => {
  const transcript = 'Indonesian students prepare important presentations alone.';
  assert.equal(spanIsGrounded('we tripled our revenue', transcript), false);
  assert.ok('students'.length < MIN_SPAN_CHARS);
  assert.equal(spanIsGrounded('students', transcript), false);
});

test('M-4 normalises compatibility characters and invisible paste artefacts', () => {
  const transcript = 'The final evidence is ＴＲＡＣＥＡＢＬＥ\u200b to the transcript.';
  assert.equal(spanIsGrounded('traceable to the transcript', transcript), true);
  assert.equal(
    findGroundedSpan('traceable to the transcript', transcript),
    'ＴＲＡＣＥＡＢＬＥ\u200b to the transcript',
  );
});
