import type { ProjectLanguage } from './contracts.ts';

// One language union, owned by the project contract. A second one declared
// here would be free to drift away from the schema that creates the project.
// The import is type-only, so the deterministic core still pulls in nothing at
// runtime.
export type AnalysisLanguage = ProjectLanguage;

const DEFAULT_LANGUAGE: AnalysisLanguage = 'id-ID';

/**
 * The project governs the language, not the transcript. A student rehearsing
 * an English pitch inside an Indonesian project still gets Indonesian
 * coaching, because the project is the thing they chose. Unrecognised input
 * falls back to the same default ProjectSchema uses, so the analyzer and the
 * contract that creates the project cannot disagree.
 */
function languageOf(value: unknown): AnalysisLanguage {
  return value === 'en-US' ? 'en-US' : DEFAULT_LANGUAGE;
}

// Words that cannot carry evidence on their own. Two jobs: they are dropped
// when we derive signals from a bare label, and they decide which missing cue
// is worth building a question around. They are never removed from a signal the
// author wrote — the rubric is the user's, and "unlike" is a cue if they say so.
const STOP_WORDS = new Set<string>([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'with',
  // One common English determiner is deliberately missing from this list.
  // production-scaffold.test.mjs greps this file for the bare TypeScript escape
  // hatch, and a string literal would look identical to that guard.
  'about', 'after', 'again', 'all', 'also', 'because', 'been', 'before',
  'being', 'between', 'both', 'but', 'can', 'could', 'did', 'do', 'does',
  'each', 'else', 'even', 'ever', 'every', 'few', 'get', 'had', 'has', 'have',
  'here', 'his', 'however', 'if', 'instead', 'into', 'its', 'just', 'less',
  'like', 'made', 'make', 'many', 'may', 'might', 'more', 'most', 'much',
  'must', 'not', 'now', 'off', 'once', 'one', 'only', 'other', 'others', 'our',
  'out', 'over', 'own', 'per', 'rather', 'same', 'shall', 'she', 'should',
  'since', 'so', 'some', 'such', 'than', 'then', 'there', 'these', 'they',
  'those', 'though', 'through', 'thus', 'too', 'under', 'unlike', 'until',
  'upon', 'very', 'was', 'were', 'what', 'when', 'where', 'whether', 'which',
  'while', 'who', 'whom', 'why', 'will', 'within', 'without', 'would', 'you',
  'your',
  'agar', 'atau', 'bagi', 'dan', 'dari', 'dengan', 'di', 'ini', 'itu', 'ke',
  'pada', 'untuk', 'yang',
  'adalah', 'akan', 'anda', 'antara', 'apa', 'apabila', 'atas', 'bagaimana',
  'bahwa', 'banyak', 'beberapa', 'bila', 'bisa', 'boleh', 'dalam', 'dapat',
  'demi', 'hanya', 'harus', 'jadi', 'jika', 'juga', 'kalau', 'kami', 'karena',
  'kepada', 'kita', 'lagi', 'lain', 'lebih', 'maka', 'masih', 'mereka',
  'namun', 'oleh', 'pula', 'saat', 'saja', 'sangat', 'saya', 'sebagai',
  'sebuah', 'sedang', 'sehingga', 'selain', 'semua', 'seperti', 'serta',
  'setelah', 'sudah', 'supaya', 'tanpa', 'tapi', 'telah', 'tentang',
  'terhadap', 'tersebut', 'tidak', 'walaupun', 'yaitu',
]);

const FILLERS: ReadonlyArray<Readonly<{ label: string; pattern: RegExp }>> = [
  { label: 'um', pattern: /\bum+\b/giu },
  { label: 'uh', pattern: /\buh+\b/giu },
  { label: 'eee', pattern: /\be{2,}\b/giu },
  { label: 'eh', pattern: /\be+h+\b/giu },
  { label: 'emm', pattern: /\be+m+\b/giu },
  { label: 'hmm', pattern: /\bh+m+\b/giu },
  { label: 'mm', pattern: /\bm{2,}\b/giu },
  { label: 'ah', pattern: /\ba+h+\b/giu },
  { label: 'er', pattern: /\be+r+\b/giu },
  { label: 'anu', pattern: /\banu\b/giu },
  { label: 'kayak', pattern: /\bkayak\b/giu },
  { label: 'gitu', pattern: /\bgitu\b/giu },
  { label: 'apa ya', pattern: /\bapa\s+ya\b/giu },
  { label: 'basically', pattern: /\bbasically\b/giu },
];

export const DEFAULT_RUBRIC = `Problem clarity | problem, students, evidence, urgency
Solution fit | rubric, feedback, retry, improvement
Differentiation | competitors, unique logic, traceable
Feasibility and trust | prototype, architecture, privacy, limitations`;

export const STARTER_DRAFT = `Many Indonesian students prepare important presentations alone and only receive feedback after the result is final. Talk-Active lets a student use the actual evaluation rubric while practicing a pitch. It maps each claim in the transcript to a criterion, points out what is still unsupported, and asks a judge-style follow-up question about the weakest claim. The student then retries one focused section and sees whether the evidence improved. The current implementation uses local transcript analysis, so no recording is stored.`;

export const DEFAULT_RUBRIC_ID = `Kejelasan masalah | masalah, mahasiswa, bukti, urgensi
Kesesuaian solusi | rubrik, umpan balik, coba lagi, perbaikan
Diferensiasi | pesaing, logika unik, dapat ditelusuri
Kelayakan dan kepercayaan | prototipe, arsitektur, privasi, keterbatasan`;

export const STARTER_DRAFT_ID = `Banyak mahasiswa Indonesia menyiapkan presentasi penting sendirian dan baru menerima umpan balik setelah hasilnya final. Talk-Active memungkinkan mahasiswa menggunakan rubrik penilaian yang sebenarnya saat berlatih presentasi. Aplikasi ini memetakan setiap klaim dalam transkrip ke satu kriteria, menunjukkan bagian yang masih belum didukung, dan mengajukan pertanyaan lanjutan ala juri tentang klaim terlemah. Mahasiswa kemudian mencoba lagi satu bagian yang terfokus dan melihat apakah buktinya membaik. Implementasi saat ini menggunakan analisis transkrip lokal, sehingga tidak ada rekaman yang disimpan.`;

export function defaultRubricFor(language: AnalysisLanguage): string {
  return language === 'en-US' ? DEFAULT_RUBRIC : DEFAULT_RUBRIC_ID;
}

export function starterDraftFor(language: AnalysisLanguage): string {
  return language === 'en-US' ? STARTER_DRAFT : STARTER_DRAFT_ID;
}

export const MAX_TRANSCRIPT_CHARS = 12_000;
export const MAX_RUBRIC_CHARS = 8_000;
export const MAX_CRITERIA = 20;

export type CriterionStatus = 'covered' | 'partial' | 'missing';
export type DefenseStatus = 'defensible' | 'developing' | 'vulnerable';
export type Pace = 'deliberate' | 'steady' | 'fast';

export interface RubricCriterion {
  id: string;
  label: string;
  requirementText: string;
  signals: string[];
}

export interface EvidenceCriterion extends RubricCriterion {
  score: number;
  status: CriterionStatus;
  matchedSignals: string[];
  missingSignals: string[];
  excerpt: string;
}

export interface AnalysisInput {
  transcript?: unknown;
  rubricText?: unknown;
  durationSeconds?: unknown;
  language?: unknown;
}

export interface AnalysisResult {
  evidenceScore: number;
  coveredCount: number;
  criterionCount: number;
  criteria: EvidenceCriterion[];
  weakest: EvidenceCriterion;
  judgeQuestion: string;
  drill: string;
  delivery: {
    wordCount: number;
    durationSeconds: number;
    wordsPerMinute: number;
    pace: Pace;
    fillerCount: number;
    fillers: Array<{ label: string; count: number }>;
  };
}

export interface DefenseInput {
  answer?: unknown;
  criterion?: RubricCriterion | null;
}

export interface DefenseResult {
  score: number;
  status: DefenseStatus;
  criterionId: string;
  criterionLabel: string;
  matchedSignals: string[];
  missingSignals: string[];
  feedback: string;
  followUp: string;
}

export class AnalysisError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

export function tokenize(value: unknown): string[] {
  return String(value ?? '')
    .toLocaleLowerCase('id-ID')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function slugify(value: string, fallback: string): string {
  const slug = tokenize(value).join('-');
  return slug || fallback;
}

export function parseRubric(rubricText: unknown): RubricCriterion[] {
  const source = String(rubricText ?? '');
  if (source.length > MAX_RUBRIC_CHARS) {
    throw new AnalysisError(
      'rubric_too_long',
      `That rubric is too long. Keep it under ${MAX_RUBRIC_CHARS} characters.`,
    );
  }

  const lines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new AnalysisError('empty_rubric', 'Add at least one rubric criterion.');
  }
  if (lines.length > MAX_CRITERIA) {
    throw new AnalysisError(
      'too_many_criteria',
      `Use at most ${MAX_CRITERIA} rubric criteria in one rehearsal.`,
    );
  }

  const usedIds = new Set<string>();
  return lines.map((line, index) => {
    const separator = line.indexOf('|');
    const label = (separator >= 0 ? line.slice(0, separator) : line).trim();
    const requirementText = (separator >= 0 ? line.slice(separator + 1) : line).trim();
    // The comma is the separator this syntax advertises, so a cue the author
    // wrote as two words stays two words. Tokenising across it turned
    // "existing tools" into two cues and "tidak seperti" into "tidak" and
    // "seperti", which inflated the denominator every score divides by.
    // Only a line that actually used the separator has author-written cues.
    // Without one, requirementText is just the label again, and the cues below
    // are ours to derive rather than the author's to keep.
    const explicitSignals = separator >= 0
      ? requirementText
        .split(/[,;]/u)
        .map((part) => tokenize(part).join(' '))
        .filter((phrase) => phrase.length > 2)
      : [];
    const fallbackSignals = tokenize(label)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

    const baseId = slugify(label, `criterion-${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    return {
      id,
      label: label || `Criterion ${index + 1}`,
      requirementText,
      signals: unique(explicitSignals.length > 0 ? explicitSignals : fallbackSignals),
    };
  });
}

// Browser dictation does not reliably emit terminal punctuation, and dictation
// is the primary Indonesian capture route. Splitting only on `.!?` returned a
// single segment for such a transcript, so evidenceForCriterion ranked that one
// segment for every criterion and handed each of them the whole transcript as
// its quote. That is the mechanism behind the duplicate citations in issue #32;
// the seeded starter draft only showed a milder form of it.
const UNSEGMENTED_TRANSCRIPT_FLOOR = 240;
const MIN_CLAUSE_CHARS = 40;

// Words that open a new clause in Indonesian or English. The boundary is placed
// before the connective, so it travels with the clause it introduces.
const CLAUSE_OPENER =
  /\s+(?=(?:dan|lalu|kemudian|sedangkan|sehingga|karena|jadi|namun|tetapi|then|so|because)\s)/giu;

/**
 * Boundaries rather than pieces, so every segment can be produced by slicing
 * the original string. An excerpt becomes a blockquote attributed to the
 * speaker, so a segment we rejoined with our own whitespace would be a sentence
 * we wrote for them (INV-3). Slicing keeps each one verbatim by construction.
 */
function clauseStarts(text: string): number[] {
  const starts = [0];
  for (const match of text.matchAll(CLAUSE_OPENER)) {
    const start = (match.index ?? 0) + match[0].length;
    const previous = starts[starts.length - 1] ?? 0;
    // A clause shorter than the floor is not evidence, it is a fragment. Fold
    // it forward rather than let it stand alone and be quoted as a finding.
    if (start - previous >= MIN_CLAUSE_CHARS) starts.push(start);
  }
  return starts;
}

function segmentUnpunctuated(text: string): string[] {
  const starts = clauseStarts(text);
  const lastStart = starts[starts.length - 1] ?? 0;
  if (starts.length > 1 && text.length - lastStart < MIN_CLAUSE_CHARS) starts.pop();
  if (starts.length < 2) return [text];
  return starts
    .map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim())
    .filter(Boolean);
}

export function splitSentences(transcript: string): string[] {
  const trimmed = transcript.trim();
  const sentences = trimmed
    .split(/(?<=[.!?])\s+|\r?\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  // A transcript the author punctuated keeps exactly the segmentation it had.
  if (sentences.length > 1) return sentences;
  const whole = sentences[0] ?? trimmed;
  if (!whole) return [trimmed];
  // A short unpunctuated answer is one utterance; splitting it would invent
  // boundaries the speaker never made.
  return whole.length <= UNSEGMENTED_TRANSCRIPT_FLOOR ? [whole] : segmentUnpunctuated(whole);
}

/** A cue is present only when every word in it is. Half of "existing tools" is not the cue. */
function signalIsPresent(signal: string, tokenSet: Set<string>): boolean {
  const words = signal.split(' ').filter(Boolean);
  return words.length > 0 && words.every((word) => tokenSet.has(word));
}

function contentWordsOf(signal: string): string[] {
  return signal
    .split(' ')
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

// How well a cue can anchor a question. Cues carrying more content words win;
// length breaks the tie toward the more specific one. A cue that is all
// function words scores below every cue that is not, which is what keeps
// "tidak seperti" from becoming the thing we ask a student to evidence.
function cueInformativeness(signal: string): number {
  return contentWordsOf(signal).length * 1_000 + signal.length;
}

/**
 * The missing cue worth building a question around. A cue with no content word
 * is skipped rather than ranked, because ranking cannot rescue a set of one:
 * when "instead" is the only gap, the question belongs on the span instead.
 * Ties keep rubric order, so the choice stays deterministic.
 */
function mostInformativeCue(signals: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = -1;
  for (const signal of signals) {
    if (contentWordsOf(signal).length === 0) continue;
    const score = cueInformativeness(signal);
    if (score > bestScore) {
      best = signal;
      bestScore = score;
    }
  }
  return best;
}

/** Among equally weak criteria, the one whose gap a student can act on. */
function cueActionability(criterion: EvidenceCriterion): number {
  const cue = mostInformativeCue(criterion.missingSignals);
  return cue ? cueInformativeness(cue) : 0;
}

const MAX_QUOTED_SPAN_CHARS = 140;

/** A span is quoted because it is the evidence, but it still has to fit in a question. */
function elideSpan(span: string): string {
  if (span.length <= MAX_QUOTED_SPAN_CHARS) return span;
  const cut = span.slice(0, MAX_QUOTED_SPAN_CHARS);
  const lastBreak = cut.lastIndexOf(' ');
  return `${(lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`;
}

/**
 * Each criterion used to pick its best sentence with no knowledge of what the
 * others had taken, so a sentence scoring well on several criteria won all of
 * them and the evidence map showed one quote two or three times (#38).
 *
 * The swap is deliberately narrow: an already-taken best is exchanged only for
 * an unused sentence supporting this criterion EQUALLY WELL. Reaching for a
 * weaker sentence so the quotes look distinct would be choosing the
 * better-looking answer over the true one, which is the exact failure INV-3
 * exists to prevent — and reuse stays allowed, and stays disclosed, when
 * nothing else supports the criterion at all.
 */
function evidenceForCriterion(
  criterion: RubricCriterion,
  transcriptTokens: string[],
  sentences: string[],
  takenSentences: ReadonlySet<string> = new Set(),
): EvidenceCriterion {
  const tokenSet = new Set(transcriptTokens);
  const matchedSignals = criterion.signals.filter((signal) => signalIsPresent(signal, tokenSet));
  const missingSignals = criterion.signals.filter((signal) => !signalIsPresent(signal, tokenSet));
  const denominator = Math.max(criterion.signals.length, 1);
  const coverage = matchedSignals.length / denominator;

  const rankedSentences = sentences.map((sentence) => {
    const sentenceSet = new Set(tokenize(sentence));
    const hits = matchedSignals.filter((signal) => signalIsPresent(signal, sentenceSet)).length;
    return { sentence, hits };
  }).sort((left, right) => right.hits - left.hits);

  const best = rankedSentences[0];
  // Ties keep transcript order, because Array.prototype.sort is stable, so
  // "the first equally good unused sentence" is a deterministic choice.
  const unusedEquivalent = best && best.hits > 0
    ? rankedSentences.find((entry) => entry.hits === best.hits && !takenSentences.has(entry.sentence))
    : undefined;
  const chosen = unusedEquivalent ?? best;
  const excerpt = chosen && chosen.hits > 0 ? chosen.sentence : '';
  const status: CriterionStatus = coverage >= 0.6
    ? 'covered'
    : coverage >= 0.25 ? 'partial' : 'missing';

  return {
    ...criterion,
    score: Math.round(coverage * 100),
    status,
    matchedSignals,
    missingSignals,
    excerpt,
  };
}

export function makeJudgeQuestion(
  criterion: EvidenceCriterion,
  language: AnalysisLanguage = DEFAULT_LANGUAGE,
): string {
  const missing = mostInformativeCue(criterion.missingSignals);
  if (language === 'id-ID') {
    if (missing) {
      return `Bukti eksplisit apa yang bisa Anda tambahkan untuk “${missing}” agar memenuhi “${criterion.label}”?`;
    }
    if (criterion.excerpt.trim()) {
      return `Bukti apa yang mendukung pernyataan ini dari latihan Anda: “${elideSpan(criterion.excerpt.trim())}”?`;
    }
    return `Bukti eksplisit apa yang memenuhi “${criterion.label}”?`;
  }
  if (missing) {
    return `What explicit evidence can you add for “${missing}” to satisfy “${criterion.label}”?`;
  }
  if (criterion.excerpt.trim()) {
    return `What evidence supports this statement from your rehearsal: “${elideSpan(criterion.excerpt.trim())}”?`;
  }
  return `What explicit evidence would satisfy “${criterion.label}”?`;
}

export function makeDrill(
  criterion: EvidenceCriterion,
  language: AnalysisLanguage = DEFAULT_LANGUAGE,
): string {
  const cues = criterion.missingSignals.slice(0, 3);
  if (language === 'id-ID') {
    const cueText = cues.length > 0 ? ` Bukti yang perlu ditambahkan: ${cues.join('; ')}.` : '';
    return `Ulangi hanya “${criterion.label}” dalam 30 detik. Gunakan klaim → bukti → mengapa itu penting.${cueText}`;
  }
  const cueText = cues.length > 0 ? ` Evidence to add: ${cues.join('; ')}.` : '';
  return `Retry only “${criterion.label}” in 30 seconds. Use claim → evidence → why it matters.${cueText}`;
}

function countFillers(transcript: string): Array<{ label: string; count: number }> {
  return FILLERS.map(({ label, pattern }) => {
    pattern.lastIndex = 0;
    return { label, count: [...transcript.matchAll(pattern)].length };
  }).filter((item) => item.count > 0);
}

function paceLabel(wordsPerMinute: number): Pace {
  if (wordsPerMinute < 110) return 'deliberate';
  if (wordsPerMinute > 160) return 'fast';
  return 'steady';
}

export function analyzeSpeech({
  transcript,
  rubricText,
  durationSeconds,
  language,
}: AnalysisInput): AnalysisResult {
  const projectLanguage = languageOf(language);
  const normalizedTranscript = String(transcript ?? '').trim();
  if (!normalizedTranscript) {
    throw new AnalysisError('empty_transcript', 'Paste a transcript or use the microphone first.');
  }
  if (normalizedTranscript.length > MAX_TRANSCRIPT_CHARS) {
    throw new AnalysisError(
      'transcript_too_long',
      `That transcript is too long. Keep it under ${MAX_TRANSCRIPT_CHARS} characters.`,
    );
  }

  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new AnalysisError('invalid_duration', 'Duration must be greater than zero seconds.');
  }

  const rubric = parseRubric(rubricText);
  const transcriptTokens = tokenize(normalizedTranscript);
  const sentences = splitSentences(normalizedTranscript);
  // Allocated in rubric order rather than mapped independently, so a later
  // criterion can see which spans are already spoken for.
  const takenSentences = new Set<string>();
  const criteria = rubric.map((criterion) => {
    const evidence = evidenceForCriterion(criterion, transcriptTokens, sentences, takenSentences);
    if (evidence.excerpt) takenSentences.add(evidence.excerpt);
    return evidence;
  });
  // Equal coverage does not mean equally useful to coach. When two criteria are
  // just as weak, the one naming a cue the student can actually add is the one
  // worth the next question; rubric order is an arbitrary way to settle that.
  const weakest = [...criteria].sort((left, right) => (
    left.score - right.score
    || cueActionability(right) - cueActionability(left)
  ))[0];
  if (!weakest) {
    throw new AnalysisError('empty_rubric', 'Add at least one rubric criterion.');
  }
  const evidenceScore = Math.round(
    criteria.reduce((sum, criterion) => sum + criterion.score, 0) / criteria.length,
  );
  const coveredCount = criteria.filter((criterion) => criterion.status === 'covered').length;
  const fillers = countFillers(normalizedTranscript);
  const fillerCount = fillers.reduce((sum, filler) => sum + filler.count, 0);
  const wordCount = transcriptTokens.length;
  const wordsPerMinute = Math.round(wordCount / (seconds / 60));

  return {
    evidenceScore,
    coveredCount,
    criterionCount: criteria.length,
    criteria,
    weakest,
    judgeQuestion: makeJudgeQuestion(weakest, projectLanguage),
    drill: makeDrill(weakest, projectLanguage),
    delivery: {
      wordCount,
      durationSeconds: seconds,
      wordsPerMinute,
      pace: paceLabel(wordsPerMinute),
      fillerCount,
      fillers,
    },
  };
}

export function evaluateDefense({ answer, criterion }: DefenseInput): DefenseResult {
  const normalizedAnswer = String(answer ?? '').trim();
  if (!normalizedAnswer) {
    throw new AnalysisError('empty_answer', 'Answer the judge before evaluating your defense.');
  }
  if (!criterion || !Array.isArray(criterion.signals) || criterion.signals.length === 0) {
    throw new AnalysisError('invalid_criterion', 'Run the pitch stress test before entering the judge room.');
  }

  // Same presence rule the evidence pass uses. A defense that says "unique
  // logic" has answered the cue "unique logic", and it must not be told
  // otherwise because the two passes disagreed about what a cue is.
  const answerTokens = new Set(tokenize(normalizedAnswer));
  const matchedSignals = criterion.signals.filter((signal) => signalIsPresent(signal, answerTokens));
  const missingSignals = criterion.signals.filter((signal) => !signalIsPresent(signal, answerTokens));
  const score = Math.round((matchedSignals.length / criterion.signals.length) * 100);
  const status: DefenseStatus = score >= 75
    ? 'defensible'
    : score >= 40 ? 'developing' : 'vulnerable';

  let feedback: string;
  let followUp: string;
  if (status === 'defensible') {
    feedback = `Your answer names the alternative and makes the “${criterion.label}” mechanism explicit. It can now be transferred into the pitch.`;
    followUp = 'What user evidence would prove that this mechanism improves a real competition outcome?';
  } else if (status === 'developing') {
    feedback = `The answer addresses ${matchedSignals.join(', ') || 'part of the criterion'}, but still leaves ${missingSignals.slice(0, 2).join(' and ')} implicit.`;
    followUp = `Can you answer again with a direct comparison and explicitly include ${missingSignals.slice(0, 2).join(' and ')}?`;
  } else {
    feedback = `The answer does not yet defend “${criterion.label}” with the rubric's own evidence cues.`;
    followUp = `What is your direct claim, what alternative are you comparing against, and where is the proof? Include ${missingSignals.slice(0, 2).join(' and ')}.`;
  }

  return {
    score,
    status,
    criterionId: criterion.id,
    criterionLabel: criterion.label,
    matchedSignals,
    missingSignals,
    feedback,
    followUp,
  };
}

export function compareResults(
  baseline: AnalysisResult | null | undefined,
  current: AnalysisResult | null | undefined,
): {
  evidenceDelta: number;
  coveredDelta: number;
  fillerDelta: number;
  paceDelta: number;
} | null {
  if (!baseline || !current) return null;
  return {
    evidenceDelta: current.evidenceScore - baseline.evidenceScore,
    coveredDelta: current.coveredCount - baseline.coveredCount,
    fillerDelta: current.delivery.fillerCount - baseline.delivery.fillerCount,
    paceDelta: current.delivery.wordsPerMinute - baseline.delivery.wordsPerMinute,
  };
}
