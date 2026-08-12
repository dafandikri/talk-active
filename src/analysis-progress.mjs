// ============================================================================
//  What the interface is allowed to say while an attempt is being reviewed.
//
//  Reviewing an attempt runs two passes. The deterministic one finishes before
//  the user sees anything. The semantic one is a network round trip that may
//  take twenty seconds, and until now the user watched a single unchanging
//  spinner for all of it — indistinguishable from a hung page.
//
//  The constraint that shapes this module is INV-2. The browser genuinely
//  knows three things: that cue matching finished and over how many criteria,
//  that a request is in flight and for how long, and how it ended. It does NOT
//  know how far through the rubric the model is. So there is no "criterion 2
//  of 4" here, however much better it would look — test/analysis-progress.test.mjs
//  fails the build if one appears.
// ============================================================================

// Must equal DEFAULT_TOTAL_BUDGET_MS in src/semantic.mjs. The panel tells the
// user when the fallback happens, so the two numbers cannot drift apart; the
// test suite compares them directly.
export const FALLBACK_AFTER_MS = 22_000;

/** @param {number} count @returns {string} */
function criteriaPhrase(count) {
  const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${total} ${total === 1 ? 'criterion' : 'criteria'}`;
}

// A gateway model id is "vendor/model". The vendor is the part worth showing:
// it is what the reader can act on when one provider is having a bad day.
/** @param {string|null|undefined} model @returns {string|null} */
function vendorOf(model) {
  const vendor = String(model ?? '').split('/')[0]?.trim() ?? '';
  return vendor && vendor !== 'undefined' ? vendor : null;
}

// Reasons arrive from src/semantic.mjs and range from meaningful to raw
// transport noise. Known ones are translated; anything unrecognised is
// dropped rather than shown, because "HTTP 503 upstream_connect_error" tells
// a student nothing and reads as a broken product rather than a working
// fallback. Never invent a reason that was not reported.
/** @type {ReadonlyArray<readonly [RegExp, string]>} */
const FALLBACK_REASONS = [
  [/no quoted span/iu, 'The model could not point to a sentence in your transcript, so its answer was rejected.'],
  [/budget exhausted|timed out|timeout/iu, 'The language model did not answer in time.'],
  [/no gateway credentials|fetch unavailable/iu, 'No language model is configured, so this ran entirely on your device.'],
  [/rubric could not be parsed/iu, 'The rubric could not be read as criteria.'],
];

/**
 * @param {string|null|undefined} reason
 * @returns {string} a leading-space sentence, or '' when the reason is unknown
 */
function explain(reason) {
  const text = String(reason ?? '');
  const match = FALLBACK_REASONS.find(([pattern]) => pattern.test(text));
  return match ? ` ${match[1]}` : '';
}

/**
 * @param {number} elapsedMs
 * @param {'semantic'|'deterministic'|null} outcome
 * @param {string|null} model
 * @param {string|null} reason
 * @returns {{id: string, state: 'done'|'active'|'skipped', label: string, detail: string}}
 */
function semanticStage(elapsedMs, outcome, model, reason) {
  if (outcome === 'semantic') {
    const vendor = vendorOf(model);
    return {
      id: 'semantic',
      state: 'done',
      label: 'Evidence quoted from your words',
      detail: vendor
        ? `Answered by ${vendor}. Every quote was checked against your transcript before it was shown.`
        : 'Every quote was checked against your transcript before it was shown.',
    };
  }
  if (outcome === 'deterministic') {
    return {
      id: 'semantic',
      state: 'skipped',
      label: 'No language-model answer this time',
      detail: `Showing the cue-matched result instead.${explain(reason)} Nothing is missing from the review.`,
    };
  }
  return {
    id: 'semantic',
    state: 'active',
    label: 'Looking for the sentence behind each claim',
    detail: `${Math.floor(Math.max(0, elapsedMs) / 1000)}s — falls back to the cue-matched result at ${FALLBACK_AFTER_MS / 1000}s.`,
  };
}

/**
 * The stages to display for one review, newest state first to last.
 *
 * @param {{criteriaCount: number, elapsedMs?: number, outcome?: 'semantic'|'deterministic'|null,
 *          model?: string|null, reason?: string|null}} input
 * @returns {Array<{id: string, state: 'done'|'active'|'skipped', label: string, detail: string}>}
 */
export function analysisStages({ criteriaCount, elapsedMs = 0, outcome = null, model = null, reason = null }) {
  return [
    {
      id: 'deterministic',
      state: 'done',
      label: 'Cue matching complete',
      detail: `${criteriaPhrase(criteriaCount)} checked on this device.`,
    },
    semanticStage(elapsedMs, outcome, model, reason),
  ];
}
