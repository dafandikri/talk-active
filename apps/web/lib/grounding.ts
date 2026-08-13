// Grounding is a deterministic property, not a model opinion. A verdict may
// cite typographically normalised text, but it only counts if those words map
// back to a real, displayable span in the student's original transcript.

export const MIN_SPAN_CHARS = 12;

interface NormalisedText {
  text: string;
  starts: number[];
  ends: number[];
}

function normalisedUnit(character: string): string {
  return character
    .normalize('NFKC')
    .replace(/[‘’‛]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, '-')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .toLocaleLowerCase('id-ID');
}

function normaliseWithOffsets(value: unknown): NormalisedText {
  const source = String(value ?? '');
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let sourceOffset = 0;

  for (const character of source) {
    const start = sourceOffset;
    sourceOffset += character.length;
    const unit = normalisedUnit(character);

    for (let index = 0; index < unit.length; index += 1) {
      const output = unit[index];
      if (!output) continue;
      if (/\s/u.test(output)) {
        if (text.length === 0 || text.endsWith(' ')) continue;
        text += ' ';
      } else {
        text += output;
      }
      starts.push(start);
      ends.push(sourceOffset);
    }
  }

  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    starts.pop();
    ends.pop();
  }

  return { text, starts, ends };
}

export function normaliseForGrounding(value: unknown): string {
  return normaliseWithOffsets(value).text;
}

export interface GroundedRange {
  /** The span exactly as it appears in the original transcript. */
  span: string;
  /** Inclusive character offset of the span in the original transcript. */
  start: number;
  /** Exclusive character offset of the span in the original transcript. */
  end: number;
}

// The offsets were always computed to cut the span out. Returning them lets a
// caller place the quote inside the transcript — to mark it in the text, or to
// ask when it was spoken — instead of only proving that it exists.
export function findGroundedRange(
  span: unknown,
  transcript: unknown,
  minimumChars = MIN_SPAN_CHARS,
): GroundedRange | null {
  const needle = normaliseForGrounding(span);
  if (!Number.isSafeInteger(minimumChars) || minimumChars < 1) {
    throw new Error('minimumChars must be a positive integer.');
  }
  if (needle.length < minimumChars) return null;

  const source = String(transcript ?? '');
  const haystack = normaliseWithOffsets(source);
  const matchAt = haystack.text.indexOf(needle);
  if (matchAt < 0) return null;

  const start = haystack.starts[matchAt];
  const end = haystack.ends[matchAt + needle.length - 1];
  if (start === undefined || end === undefined) return null;
  return { span: source.slice(start, end), start, end };
}

export function findGroundedSpan(
  span: unknown,
  transcript: unknown,
  minimumChars = MIN_SPAN_CHARS,
): string | null {
  return findGroundedRange(span, transcript, minimumChars)?.span ?? null;
}

export function spanIsGrounded(span: unknown, transcript: unknown): boolean {
  return findGroundedSpan(span, transcript) !== null;
}
