const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'with',
  'agar', 'atau', 'bagi', 'dan', 'dari', 'dengan', 'di', 'ini', 'itu', 'ke',
  'pada', 'untuk', 'yang',
]);

const FILLERS = [
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

// These ceilings are product boundaries and cost controls. A 7-minute pitch is
// normally well below 12,000 characters, while 8,000 rubric characters and 20
// criteria comfortably cover the published finals matrix. Refuse oversized
// input before any paid semantic call rather than silently truncating evidence.
export const MAX_TRANSCRIPT_CHARS = 12_000;
export const MAX_RUBRIC_CHARS = 8_000;
export const MAX_CRITERIA = 20;

export class AnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

export function tokenize(value) {
  return String(value ?? '')
    .toLocaleLowerCase('id-ID')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function unique(values) {
  return [...new Set(values)];
}

function slugify(value, fallback) {
  const slug = tokenize(value).join('-');
  return slug || fallback;
}

export function parseRubric(rubricText) {
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

  return lines.map((line, index) => {
    const separator = line.indexOf('|');
    const label = (separator >= 0 ? line.slice(0, separator) : line).trim();
    const requirementText = (separator >= 0 ? line.slice(separator + 1) : line).trim();
    const explicitSignals = requirementText
      .split(',')
      .flatMap((part) => tokenize(part))
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
    const fallbackSignals = tokenize(label)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

    return {
      id: slugify(label, `criterion-${index + 1}`),
      label: label || `Criterion ${index + 1}`,
      requirementText,
      signals: unique(explicitSignals.length > 0 ? explicitSignals : fallbackSignals),
    };
  });
}

function splitSentences(transcript) {
  const sentences = String(transcript)
    .split(/(?<=[.!?])\s+|\r?\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [String(transcript).trim()];
}

function evidenceForCriterion(criterion, transcriptTokens, sentences) {
  const tokenSet = new Set(transcriptTokens);
  const matchedSignals = criterion.signals.filter((signal) => tokenSet.has(signal));
  const missingSignals = criterion.signals.filter((signal) => !tokenSet.has(signal));
  const denominator = Math.max(criterion.signals.length, 1);
  const coverage = matchedSignals.length / denominator;

  const rankedSentences = sentences.map((sentence) => {
    const sentenceSet = new Set(tokenize(sentence));
    const hits = matchedSignals.filter((signal) => sentenceSet.has(signal)).length;
    return { sentence, hits };
  }).sort((left, right) => right.hits - left.hits);

  const best = rankedSentences[0];
  const excerpt = best?.hits > 0 ? best.sentence : '';
  const status = coverage >= 0.6 ? 'covered' : coverage >= 0.25 ? 'partial' : 'missing';

  return {
    ...criterion,
    score: Math.round(coverage * 100),
    status,
    matchedSignals,
    missingSignals,
    excerpt,
  };
}

export function makeJudgeQuestion(criterion) {
  const label = criterion.label.toLocaleLowerCase('en-US');
  const missing = criterion.missingSignals.slice(0, 2).join(' and ');
  const missingPrompt = missing ? ` Evidence still missing: ${missing}.` : '';

  if (label.includes('problem')) {
    return `What direct evidence proves this problem is urgent for your specific users?${missingPrompt}`;
  }
  if (label.includes('solution')) {
    return `Walk me through one user attempt from input to measurable improvement. Where does the product create value that a generic chatbot cannot?${missingPrompt}`;
  }
  if (label.includes('different') || label.includes('unique') || label.includes('innovation')) {
    return `Existing speaking coaches already support Indonesian practice and feedback. What unique product logic would make a student choose Talk-Active?${missingPrompt}`;
  }
  if (label.includes('feasib') || label.includes('technical') || label.includes('trust')) {
    return `Which part works in the prototype today, which part is simulated, and how will you keep recordings and scoring trustworthy?${missingPrompt}`;
  }
  return `Your weakest area is “${criterion.label}.” What concrete claim and evidence would convince a skeptical judge?${missingPrompt}`;
}

export function makeDrill(criterion) {
  const cues = criterion.missingSignals.slice(0, 3);
  const cueText = cues.length > 0 ? ` Evidence to add: ${cues.join('; ')}.` : '';
  return `Retry only “${criterion.label}” in 30 seconds. Use claim → evidence → why it matters.${cueText}`;
}

function countFillers(transcript) {
  return FILLERS.map(({ label, pattern }) => {
    pattern.lastIndex = 0;
    return { label, count: [...String(transcript).matchAll(pattern)].length };
  }).filter((item) => item.count > 0);
}

function paceLabel(wordsPerMinute) {
  if (wordsPerMinute < 110) return 'deliberate';
  if (wordsPerMinute > 160) return 'fast';
  return 'steady';
}

export function analyzeSpeech({ transcript, rubricText, durationSeconds }) {
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
  const criteria = rubric.map((criterion) => (
    evidenceForCriterion(criterion, transcriptTokens, sentences)
  ));
  const weakest = [...criteria].sort((left, right) => left.score - right.score)[0];
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
    judgeQuestion: makeJudgeQuestion(weakest),
    drill: makeDrill(weakest),
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

export function evaluateDefense({ answer, criterion }) {
  const normalizedAnswer = String(answer ?? '').trim();
  if (!normalizedAnswer) {
    throw new AnalysisError('empty_answer', 'Answer the judge before evaluating your defense.');
  }
  if (!criterion || !Array.isArray(criterion.signals) || criterion.signals.length === 0) {
    throw new AnalysisError('invalid_criterion', 'Run the pitch stress test before entering the judge room.');
  }

  const answerTokens = new Set(tokenize(normalizedAnswer));
  const matchedSignals = criterion.signals.filter((signal) => answerTokens.has(signal));
  const missingSignals = criterion.signals.filter((signal) => !answerTokens.has(signal));
  const score = Math.round((matchedSignals.length / criterion.signals.length) * 100);
  const status = score >= 75 ? 'defensible' : score >= 40 ? 'developing' : 'vulnerable';

  let feedback;
  let followUp;
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

export function compareResults(baseline, current) {
  if (!baseline || !current) return null;
  return {
    evidenceDelta: current.evidenceScore - baseline.evidenceScore,
    coveredDelta: current.coveredCount - baseline.coveredCount,
    fillerDelta: current.delivery.fillerCount - baseline.delivery.fillerCount,
    paceDelta: current.delivery.wordsPerMinute - baseline.delivery.wordsPerMinute,
  };
}
