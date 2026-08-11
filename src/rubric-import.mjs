// ============================================================================
//  Rubric import — turn a pasted scoring matrix into criteria.
//
//  The output is the SAME `label | cues` line format the manual editor and
//  parseRubric already use, so importing changes no data model and no storage
//  shape. Import is a convenience over typing, never a second source of truth.
//
//  Nothing is persisted here. The student confirms the parse before it is
//  saved, because the system must never silently guess what an evaluator meant.
// ============================================================================
import {
  AnalysisError,
  MAX_CRITERIA as ANALYSIS_MAX_CRITERIA,
  MAX_RUBRIC_CHARS,
} from './analyzer.mjs';
import {
  DEFAULT_TIMEOUT_MS,
  MODEL_CHAIN,
  callGateway,
  extractJsonPayload,
  selectApiCredential,
} from './semantic.mjs';

export const MAX_IMPORT_CHARS = MAX_RUBRIC_CHARS;
export const MAX_CRITERIA = ANALYSIS_MAX_CRITERIA;

export class ImportUnavailable extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ImportUnavailable';
  }
}

export function buildImportMessages(rubricText) {
  const source = String(rubricText ?? '').trim();
  if (!source) {
    throw new AnalysisError('empty_rubric', 'Paste the scoring matrix first.');
  }
  // INV-7: refuse loudly. Silently truncating would drop criteria the student
  // believes were imported — the worst possible failure for this feature.
  if (source.length > MAX_IMPORT_CHARS) {
    throw new AnalysisError('rubric_too_long', `That rubric is too long to import. Keep it under ${MAX_IMPORT_CHARS} characters.`);
  }

  return [
    {
      role: 'system',
      content: [
        'You convert an evaluator\'s scoring matrix into structured criteria.',
        'Return only criteria that are present in the source text. Never invent a criterion, and never merge two into one.',
        'For each criterion give a short label and 2 to 5 lowercase cue words a speaker would actually say to satisfy it.',
        'Respond with JSON only: {"criteria":[{"label":"...","cues":["...","..."]}]}',
      ].join(' '),
    },
    { role: 'user', content: source },
  ];
}

export function parseImportedRubric(payload) {
  const criteria = Array.isArray(payload?.criteria) ? payload.criteria : [];

  const lines = criteria
    .map((criterion) => {
      const label = String(criterion?.label ?? '').trim().replace(/\|/gu, '-');
      const cues = Array.isArray(criterion?.cues)
        ? criterion.cues.map((cue) => String(cue).trim().replace(/[|,]/gu, ' ')).filter(Boolean)
        : [];
      if (!label) return null;
      return cues.length > 0 ? `${label} | ${cues.join(', ')}` : label;
    })
    .filter(Boolean)
    .slice(0, MAX_CRITERIA);

  if (lines.length === 0) {
    throw new ImportUnavailable('the response contained no criteria');
  }

  return lines.join('\n');
}

// One structuring pass per vendor, cheapest first. Import runs once per
// project, so a failure costs a retry — never a broken session. On total
// failure the caller falls back to the manual editor with the raw paste
// intact, which is why this throws instead of returning a partial rubric.
export async function importRubric({
  rubricText,
  apiKey = selectApiCredential(),
  models = MODEL_CHAIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const messages = buildImportMessages(rubricText);
  if (!apiKey) throw new ImportUnavailable('no credentials');

  for (const model of models) {
    try {
      const text = await callGateway({ messages, apiKey, model, timeoutMs, fetchImpl });
      return { rubricText: parseImportedRubric(extractJsonPayload(text)), mode: 'semantic' };
    } catch {
      // Try the next vendor. Availability comes from provider diversity.
    }
  }

  throw new ImportUnavailable('that rubric could not be imported automatically');
}
