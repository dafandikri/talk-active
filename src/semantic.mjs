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
import { analyzeSpeech, parseRubric } from './analyzer.mjs';

export const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';
export const DEFAULT_TIMEOUT_MS = 12_000;

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

function extractJson(text) {
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
function spanIsGrounded(span, transcript) {
  const needle = String(span ?? '').trim().toLowerCase();
  if (needle.length < 12) return false;
  return transcript.toLowerCase().includes(needle);
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
    if (!verdict || !STATUSES.has(verdict.status)) return criterion;

    const span = String(verdict.span ?? '').trim();
    const supported = verdict.status !== 'missing';
    if (supported) claimedSupport += 1;

    // INV-3: a supporting verdict without a real, quoted span is discarded.
    if (supported && !spanIsGrounded(span, transcript)) return criterion;
    if (supported) grounded += 1;

    const missing = Array.isArray(verdict.missing)
      ? verdict.missing.map((item) => String(item)).filter(Boolean).slice(0, 5)
      : criterion.missingSignals;

    const score = verdict.status === 'covered' ? 100 : verdict.status === 'partial' ? 55 : 0;

    return {
      ...criterion,
      score,
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

  const weakest = [...criteria].sort((left, right) => left.score - right.score)[0];
  const evidenceScore = Math.round(
    criteria.reduce((sum, criterion) => sum + criterion.score, 0) / criteria.length,
  );

  return {
    ...base,
    criteria,
    weakest,
    evidenceScore,
    coveredCount: criteria.filter((criterion) => criterion.status === 'covered').length,
  };
}

// ---------------------------------------------------------------------------
// Gateway call
// ---------------------------------------------------------------------------

async function callGateway({ messages, apiKey, model, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new SemanticUnavailable(`gateway responded ${response.status}`);
    }
    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content;
    if (!text) throw new SemanticUnavailable('gateway returned an empty completion');
    return extractJson(text);
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
  apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  // Deterministic first: this validates input and guarantees a usable result.
  const base = analyzeSpeech({ transcript, rubricText, durationSeconds });

  if (!apiKey) {
    return { ...base, mode: 'deterministic', degradedReason: 'no gateway credentials' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ...base, mode: 'deterministic', degradedReason: 'fetch unavailable' };
  }

  try {
    const rubric = parseRubric(rubricText);
    const payload = await callGateway({
      messages: buildMessages(String(transcript).trim(), rubric),
      apiKey,
      model,
      timeoutMs,
      fetchImpl,
    });
    const enriched = applySemanticVerdicts(base, payload, String(transcript).trim());
    return { ...enriched, mode: 'semantic' };
  } catch (error) {
    // AD-3: degrade, never fail. The demo must survive a dead API.
    return {
      ...base,
      mode: 'deterministic',
      degradedReason: error instanceof SemanticUnavailable ? error.message : 'semantic analysis failed',
    };
  }
}
