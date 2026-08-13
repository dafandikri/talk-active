/**
 * Two word families invite an evaluator's next question: quantities that
 * cannot be checked ("banyak" — how many?) and hedges that weaken the claim
 * before anyone challenges it ("kayaknya" — so you are not sure?).
 *
 * This is plain token matching in the same shape as filler-cues.ts:
 * deterministic, on this device, and reporting only words the student
 * actually said. Each cue carries the question it invites, because "3 hedges"
 * is not something anyone can practise against while "banyak — berapa
 * tepatnya?" is.
 */

import { tokenizeSpeech } from './filler-cues.ts';

export type WordingCueKind = 'vague-quantity' | 'hedge';

export interface WordingCueMatch {
  kind: WordingCueKind;
  label: string;
  tokenIndexes: number[];
}

export interface WordingCueSummary {
  kind: WordingCueKind;
  label: string;
  count: number;
  /** The follow-up this wording invites, phrased as an evaluator would ask it. */
  invites: string;
}

interface WordingCueDefinition {
  kind: WordingCueKind;
  label: string;
  tokens: readonly string[];
  invites: string;
}

// Single-token cues. Two-word cues are matched first, below, so "hampir
// semua" is counted once rather than as a separate "semua".
const SINGLE_TOKEN_CUES: readonly WordingCueDefinition[] = [
  { kind: 'vague-quantity', label: 'banyak', tokens: ['banyak'], invites: 'Berapa tepatnya?' },
  { kind: 'vague-quantity', label: 'beberapa', tokens: ['beberapa'], invites: 'Berapa tepatnya?' },
  { kind: 'vague-quantity', label: 'sebagian', tokens: ['sebagian'], invites: 'Sebagian itu berapa dari berapa?' },
  { kind: 'vague-quantity', label: 'cukup', tokens: ['cukup'], invites: 'Cukup diukur dengan apa?' },
  { kind: 'vague-quantity', label: 'lumayan', tokens: ['lumayan'], invites: 'Lumayan itu berapa?' },
  { kind: 'vague-quantity', label: 'sering', tokens: ['sering'], invites: 'Seberapa sering, diukur bagaimana?' },
  { kind: 'vague-quantity', label: 'many', tokens: ['many'], invites: 'How many exactly?' },
  { kind: 'vague-quantity', label: 'some', tokens: ['some'], invites: 'How many exactly?' },
  { kind: 'vague-quantity', label: 'several', tokens: ['several'], invites: 'How many exactly?' },
  { kind: 'vague-quantity', label: 'often', tokens: ['often'], invites: 'How often, measured how?' },
  { kind: 'hedge', label: 'kayaknya', tokens: ['kayaknya'], invites: 'Jadi belum pasti?' },
  { kind: 'hedge', label: 'sepertinya', tokens: ['sepertinya'], invites: 'Jadi belum pasti?' },
  { kind: 'hedge', label: 'mungkin', tokens: ['mungkin'], invites: 'Mungkin, atau sudah terjadi?' },
  { kind: 'hedge', label: 'agak', tokens: ['agak'], invites: 'Agak — seberapa?' },
  { kind: 'hedge', label: 'maybe', tokens: ['maybe'], invites: 'Maybe, or did it happen?' },
  { kind: 'hedge', label: 'probably', tokens: ['probably'], invites: 'Probably, or measured?' },
  { kind: 'hedge', label: 'perhaps', tokens: ['perhaps'], invites: 'Perhaps, or did it happen?' },
];

const BIGRAM_CUES: readonly WordingCueDefinition[] = [
  { kind: 'vague-quantity', label: 'hampir semua', tokens: ['hampir', 'semua'], invites: 'Hampir semua itu berapa dari berapa?' },
  { kind: 'hedge', label: 'kira-kira', tokens: ['kira', 'kira'], invites: 'Kira-kira, atau sudah dihitung?' },
  { kind: 'hedge', label: 'kind of', tokens: ['kind', 'of'], invites: 'Kind of — how much?' },
  { kind: 'hedge', label: 'sort of', tokens: ['sort', 'of'], invites: 'Sort of — how much?' },
  { kind: 'hedge', label: 'i think', tokens: ['i', 'think'], invites: 'You think, or you verified?' },
];

export function matchWordingCues(tokens: readonly string[]): WordingCueMatch[] {
  const matches: WordingCueMatch[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    if (!current) continue;
    const next = tokens[index + 1];
    const bigram = next === undefined
      ? undefined
      : BIGRAM_CUES.find(({ tokens: pair }) => pair[0] === current && pair[1] === next);
    if (bigram) {
      matches.push({ kind: bigram.kind, label: bigram.label, tokenIndexes: [index, index + 1] });
      index += 1;
      continue;
    }
    const single = SINGLE_TOKEN_CUES.find(({ tokens: [token] }) => token === current);
    if (single) matches.push({ kind: single.kind, label: single.label, tokenIndexes: [index] });
  }
  return matches;
}

export function findWordingCues(value: string): WordingCueMatch[] {
  return matchWordingCues(tokenizeSpeech(value));
}

export function summarizeWordingCues(value: string): WordingCueSummary[] {
  const definitions = [...SINGLE_TOKEN_CUES, ...BIGRAM_CUES];
  const counts = new Map<string, number>();
  for (const match of findWordingCues(value)) {
    counts.set(match.label, (counts.get(match.label) ?? 0) + 1);
  }
  return definitions
    .flatMap((definition) => {
      const count = counts.get(definition.label);
      return count === undefined ? [] : [{
        kind: definition.kind,
        label: definition.label,
        count,
        invites: definition.invites,
      }];
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}
