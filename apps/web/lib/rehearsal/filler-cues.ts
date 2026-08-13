export interface FillerTokenMatch {
  label: string;
  tokenIndexes: number[];
}

const FILLER_TOKEN_PATTERNS: ReadonlyArray<Readonly<{
  label: string;
  pattern: RegExp;
}>> = [
  { label: 'um', pattern: /^u+m+$/u },
  { label: 'uh', pattern: /^u+h+$/u },
  { label: 'ee', pattern: /^e{2,}$/u },
  { label: 'eh', pattern: /^e+h+$/u },
  { label: 'emm', pattern: /^e+m+$/u },
  { label: 'hmm', pattern: /^h+m+$/u },
  { label: 'mm', pattern: /^m{2,}$/u },
  { label: 'ah', pattern: /^a+h+$/u },
  { label: 'er', pattern: /^e+r+$/u },
  { label: 'anu', pattern: /^anu$/u },
  { label: 'kayak', pattern: /^kayak$/u },
  { label: 'gitu', pattern: /^gitu$/u },
  { label: 'basically', pattern: /^basically$/u },
];

export function tokenizeSpeech(value: string): string[] {
  return value
    .toLocaleLowerCase('id-ID')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function matchFillerTokens(tokens: readonly string[]): FillerTokenMatch[] {
  const matches: FillerTokenMatch[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (current === 'apa' && next === 'ya') {
      matches.push({ label: 'apa ya', tokenIndexes: [index, index + 1] });
      index += 1;
      continue;
    }
    if (!current) continue;
    const definition = FILLER_TOKEN_PATTERNS.find(({ pattern }) => pattern.test(current));
    if (definition) matches.push({ label: definition.label, tokenIndexes: [index] });
  }
  return matches;
}

export function findFillerCues(value: string): FillerTokenMatch[] {
  return matchFillerTokens(tokenizeSpeech(value));
}
