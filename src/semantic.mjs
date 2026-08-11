// ============================================================================
//  Semantic evidence mapping.
//
//  The proposal commits, in writing, to replacing deterministic cue matching
//  with grounded semantic analysis. This is that layer.
//
//  Design (AD-2, AD-3, AD-4):
//    * The deterministic analyzer always runs first. It supplies the response
//      shape, the delivery metrics, and a guaranteed-valid result.
//    * Semantic verdicts are then OVERLAID on that result. If anything goes
//      wrong — no key, timeout, malformed output, a verdict without a cited
//      span — we keep the deterministic result and report mode 'deterministic'.
//    * A verdict that does not quote the transcript is rejected here, in code,
//      not merely discouraged in the prompt. That is INV-3.
//
//  This module performs no I/O of its own beyond the fetch it is handed, so it
//  is testable without a network.
// ============================================================================
import { analyzeSpeech, makeDrill, makeJudgeQuestion, parseRubric } from './analyzer.mjs';

// The Vercel AI Gateway is the default, but it is not the only way in. Its free
// tier rate-limits every model and BYOK requires purchased credits, so a team
// with no budget cannot reach semantic mode through it at all.
//
// The request below is plain OpenAI-compatible `chat/completions`, which most
// providers now speak — including Google's free-tier endpoint at
// https://generativelanguage.googleapis.com/v1beta/openai/chat/completions.
// Pointing TALKACTIVE_API_URL at one of those, with TALKACTIVE_API_KEY, buys
// semantic mode for nothing. Nothing else in this file changes.
const DIRECT_API_URL = process.env.TALKACTIVE_API_URL?.trim();

export const GATEWAY_URL = DIRECT_API_URL
  || 'https://ai-gateway.vercel.sh/v1/chat/completions';

// Credentials are paired with their endpoint. In particular, a custom URL
// must never inherit Vercel's OIDC token: that token belongs only at Vercel's
// gateway and forwarding it to another provider would disclose it.
export function selectApiCredential({
  directUrl = DIRECT_API_URL,
  directKey = process.env.TALKACTIVE_API_KEY,
  gatewayKey = process.env.AI_GATEWAY_API_KEY,
  oidcToken = process.env.VERCEL_OIDC_TOKEN,
} = {}) {
  return directUrl ? directKey : (gatewayKey ?? oidcToken);
}

// Availability comes from PROVIDER diversity, not model diversity. Three models
// from one vendor share one outage; these three share nothing but the gateway.
//
// Verified live against the gateway on 10 Aug 2026:
//   * The FREE tier rate-limits every model with a 429 telling you to top up.
//     Paid credits are required for any of this to work at all.
//   * Premium models (claude-sonnet-5, gpt-5.4) additionally 403 on free tier.
//
// This chain is chosen to be cheap enough that the whole competition costs
// small change, while keeping the instruction-following needed for verbatim
// quoting. Override with TALKACTIVE_MODELS="a,b,c" to trade cost for quality
// without touching code.
//
//   anthropic/claude-haiku-4.5   $1.00/$5.00 per M — strong at reproducing an
//                                exact sentence, which is what INV-3 needs.
//   openai/gpt-5-nano            $0.05/$0.40 — different vendor, very cheap.
//   google/gemini-2.5-flash-lite $0.10/$0.40 — third vendor.
//
// Per-key Gateway quota, WAF rate limiting, prompt ceilings, and response
// caching are the four independent cost controls; see the operations runbook.
export const MODEL_CHAIN = (process.env.TALKACTIVE_MODELS ?? '')
  .split(',').map((name) => name.trim()).filter(Boolean).length > 0
  ? process.env.TALKACTIVE_MODELS.split(',').map((name) => name.trim()).filter(Boolean)
  : [
    'anthropic/claude-haiku-4.5',
    'openai/gpt-5-nano',
    'google/gemini-2.5-flash-lite',
  ];
export const DEFAULT_MODEL = MODEL_CHAIN[0];

// Per-attempt budget. Measured live: a vendor that rejects us (403/429) answers
// in well under a second, so the failing-fast cases cost almost nothing. The
// budget has to accommodate the slow case instead — gpt-5-nano is a reasoning
// model and regularly needs more than 8s, which silently cost us semantic mode
// until it was measured.
//
// The whole chain is still capped, because a judge waiting is worse than a
// deterministic answer arriving promptly.
export const DEFAULT_TIMEOUT_MS = 12_000;
export const DEFAULT_TOTAL_BUDGET_MS = 22_000;

export class SemanticUnavailable extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'SemanticUnavailable';
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildMessages(transcript, rubric) {
  const criteriaList = rubric
    .map((criterion) => `- id="${criterion.id}" label="${criterion.label}" requires: ${criterion.requirementText || criterion.signals.join(', ')}`)
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        'You judge whether a rehearsal transcript satisfies an evaluation rubric.',
        '',
        'Rules you must obey:',
        '1. Judge ONLY what the transcript actually says. Never infer intent.',
        '2. For every criterion you mark "covered" or "partial", you MUST quote the',
        '   exact sentence from the transcript that justifies it, copied verbatim.',
        '3. If the transcript does not support a criterion, mark it "missing" and',
        '   list what evidence is absent. Do not invent a quote.',
        '4. Reply with JSON only. No prose, no markdown fences.',
        '',
        'Reply with this shape:',
        '{"criteria":[{"id":"<criterion id>","status":"covered|partial|missing",',
        '"span":"<verbatim sentence from the transcript, or empty string>",',
        '"missing":["<absent evidence>"],"why":"<one short sentence>"}]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'RUBRIC CRITERIA:',
        criteriaList,
        '',
        'TRANSCRIPT:',
        transcript,
      ].join('\n'),
    },
  ];
}

// ---------------------------------------------------------------------------
// Response validation — INV-3 lives here.
// ---------------------------------------------------------------------------

export function extractJsonPayload(text) {
  const trimmed = String(text ?? '').trim();
  // Models occasionally wrap JSON in a fence despite instructions.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: the outermost object.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new SemanticUnavailable('model returned no JSON');
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new SemanticUnavailable('model returned malformed JSON');
    }
  }
}

const STATUSES = new Set(['covered', 'partial', 'missing']);

// A quoted span only counts as evidence if it is actually in the transcript.
// This is what stops a fluent model from inventing a supporting sentence.
//
// Normalisation runs on BOTH sides. Without it, a model that re-flows a quote
// across a line break, or types an em dash as a hyphen, has a CORRECT verdict
// discarded — a false negative that costs the student real credit silently.
// Case-insensitivity is kept for the same reason: case is a transcription
// artefact, not evidence of paraphrase.
export function normaliseForGrounding(value) {
  return String(value ?? '')
    .replace(/[‘’‛]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, '-')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

// Spans shorter than this match too easily to be evidence of anything: a
// four-character fragment appears in almost any transcript by chance, so it
// would ground a verdict without supporting it. Covered by
// "a span too short to be evidence never grounds".
export const MIN_SPAN_CHARS = 12;

function spanIsGrounded(span, transcript) {
  const needle = normaliseForGrounding(span);
  if (needle.length < MIN_SPAN_CHARS) return false;
  return normaliseForGrounding(transcript).includes(needle);
}

export function applySemanticVerdicts(base, payload, transcript) {
  const verdicts = payload?.criteria;
  if (!Array.isArray(verdicts) || verdicts.length === 0) {
    throw new SemanticUnavailable('model returned no criteria');
  }

  const byId = new Map(verdicts.map((verdict) => [String(verdict?.id ?? ''), verdict]));
  // Count what the model *claimed* to support versus what it could actually
  // ground. If it claimed support and grounded none of it, the model is
  // fabricating quotes and the whole pass is untrustworthy.
  let claimedSupport = 0;
  let grounded = 0;

  const criteria = base.criteria.map((criterion) => {
    const verdict = byId.get(criterion.id);
    // No verdict for this criterion: the deterministic result stands, and we
    // say so rather than letting the overall mode badge speak for it.
    if (!verdict || !STATUSES.has(verdict.status)) {
      return { ...criterion, engine: 'deterministic' };
    }

    const span = String(verdict.span ?? '').trim();
    const supported = verdict.status !== 'missing';
    if (supported) claimedSupport += 1;

    // INV-3: a supporting verdict without a real, quoted span is discarded.
    if (supported && !spanIsGrounded(span, transcript)) {
      return { ...criterion, engine: 'deterministic' };
    }
    if (supported) grounded += 1;

    const missing = Array.isArray(verdict.missing)
      ? verdict.missing.map((item) => String(item)).filter(Boolean).slice(0, 5)
      : criterion.missingSignals;

    const score = verdict.status === 'covered' ? 100 : verdict.status === 'partial' ? 55 : 0;

    return {
      ...criterion,
      score,
      engine: 'semantic',
      status: verdict.status === 'missing' ? 'missing' : verdict.status,
      excerpt: supported ? span : '',
      missingSignals: verdict.status === 'missing' && missing.length === 0
        ? criterion.missingSignals
        : missing,
      rationale: String(verdict.why ?? '').slice(0, 200),
    };
  });

  // If the model claimed to support criteria but could not ground a single
  // quote in the transcript, it is fabricating. Reject the whole pass rather
  // than present invented evidence as semantic analysis.
  if (claimedSupport > 0 && grounded === 0) {
    throw new SemanticUnavailable('no quoted span could be found in the transcript');
  }

  const semanticCriteria = criteria.filter((item) => item.engine === 'semantic').length;

  const weakest = [...criteria].sort((left, right) => left.score - right.score)[0];
  const evidenceScore = Math.round(
    criteria.reduce((sum, criterion) => sum + criterion.score, 0) / criteria.length,
  );

  return {
    ...base,
    criteria,
    weakest,
    judgeQuestion: makeJudgeQuestion(weakest),
    drill: makeDrill(weakest),
    evidenceScore,
    coveredCount: criteria.filter((criterion) => criterion.status === 'covered').length,
    semanticCriteria,
    totalCriteria: criteria.length,
  };
}

// ---------------------------------------------------------------------------
// Gateway call
// ---------------------------------------------------------------------------

export async function callGateway({ messages, apiKey, model, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // No response_format: the gateway rejects it outright ("Invalid input").
      // No token cap either: vendors disagree on max_tokens vs
      // max_completion_tokens and the minimums differ. The prompt asks for JSON
      // and extractJsonPayload() copes with fences or stray prose, which is the
      // portable way to get structured output across three vendors.
      body: JSON.stringify({ model, messages, temperature: 0 }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Include the gateway's explanation. A bare status code turned a simple
      // "you must add paid credits" into a debugging session.
      let detail = '';
      try {
        const problem = await response.json();
        detail = problem?.error?.message ? `: ${String(problem.error.message).slice(0, 160)}` : '';
      } catch { /* body was not JSON */ }
      throw new SemanticUnavailable(`gateway responded ${response.status}${detail}`);
    }
    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content;
    if (!text) throw new SemanticUnavailable('gateway returned an empty completion');
    return text;
  } catch (error) {
    if (error instanceof SemanticUnavailable) throw error;
    if (error?.name === 'AbortError') throw new SemanticUnavailable('gateway timed out');
    throw new SemanticUnavailable(error?.message ?? 'gateway call failed');
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Analyse a transcript, preferring semantic evidence mapping and degrading to
 * deterministic cue matching. Never throws for AI reasons; only invalid user
 * input throws (INV-7), which the deterministic analyzer decides.
 */
export async function analyzeWithSemantics({
  transcript,
  rubricText,
  durationSeconds,
  apiKey = selectApiCredential(),
  models = MODEL_CHAIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  totalBudgetMs = DEFAULT_TOTAL_BUDGET_MS,
  fetchImpl = globalThis.fetch,
  onAttempt = () => {},
} = {}) {
  // Deterministic first: this validates input and guarantees a usable result.
  const base = analyzeSpeech({ transcript, rubricText, durationSeconds });

  if (!apiKey) {
    return { ...base, mode: 'deterministic', degradedReason: 'no gateway credentials' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ...base, mode: 'deterministic', degradedReason: 'fetch unavailable' };
  }

  const cleanTranscript = String(transcript).trim();
  let rubric;
  try {
    rubric = parseRubric(rubricText);
  } catch {
    return { ...base, mode: 'deterministic', degradedReason: 'rubric could not be parsed' };
  }

  const messages = buildMessages(cleanTranscript, rubric);
  const startedAt = Date.now();
  const attempts = [];

  // Walk the provider chain. A model that errors, times out, returns prose, or
  // fabricates a quote hands off to the next vendor. Only when every vendor has
  // failed do we degrade — and even then the user still gets a full review.
  for (const model of models) {
    const remaining = totalBudgetMs - (Date.now() - startedAt);
    if (remaining <= 500) {
      attempts.push({ model, error: 'skipped: total budget exhausted' });
      break;
    }

    try {
      const text = await callGateway({
        messages,
        apiKey,
        model,
        timeoutMs: Math.min(timeoutMs, remaining),
        fetchImpl,
      });
      const payload = extractJsonPayload(text);
      const enriched = applySemanticVerdicts(base, payload, cleanTranscript);
      attempts.push({ model, ok: true });
      onAttempt(attempts);
      return { ...enriched, mode: 'semantic', model, attempts };
    } catch (error) {
      const reason = error instanceof SemanticUnavailable ? error.message : (error?.message ?? 'failed');
      attempts.push({ model, error: reason });
    }
  }

  onAttempt(attempts);
  // AD-3: degrade, never fail. The demo must survive every provider being down.
  return {
    ...base,
    mode: 'deterministic',
    degradedReason: attempts.at(-1)?.error ?? 'semantic analysis unavailable',
    attempts,
  };
}
