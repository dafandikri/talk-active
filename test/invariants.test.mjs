// ============================================================================
//  WINNING INVARIANTS — deterministic enforcement.
//
//  These are not style preferences. Each one is derived from the property that
//  produced our preliminary-round result: the smallest judge-to-judge spread in
//  the field (0.60, versus 1.20 for first place and up to 11.58 elsewhere).
//
//  Six teams beat our best single-judge score at least once. Five of them
//  finished below us. In a three-judge mean, the FLOOR ranks you, so every
//  invariant here exists to remove a reason an evaluator could mark us down.
//
//  Failing any test in this file fails `pnpm check`. That is deliberate.
//  See AGENTS.md "Invariants" for the law these tests enforce.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_RUBRIC, STARTER_DRAFT, analyzeSpeech } from '../src/analyzer.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

// LaTeX and HTML wrap freely, so phrase checks must ignore how the source is
// line-broken. Collapsing whitespace keeps these tests about meaning, not layout.
const flat = (text) => text.replace(/\s+/gu, ' ');

// assert.match dumps the entire file into the failure output, which makes the
// gate unreadable at 2am. Report the rule that broke instead.
function assertContains(text, pattern, message) {
  assert.ok(pattern.test(flat(text)), message);
}

// Files that make claims to a user or an evaluator.
const PRODUCT_SURFACES = ['index.html', 'src/app.mjs', 'src/analyzer.mjs'];
const PROPOSAL_BODY = 'docs/proposal/body.tex';
const PROPOSAL_REFS = 'docs/proposal/backmatter.tex';

// ---------------------------------------------------------------------------
// INV-1  Every external fact is traceable to a source.
//        A number a judge cannot verify is a number a judge can discount.
// ---------------------------------------------------------------------------

test('INV-1 every citation resolves to a real reference', () => {
  const body = read(PROPOSAL_BODY);
  const refs = read(PROPOSAL_REFS);
  if (!body || !refs) return; // proposal not present in this checkout

  const cited = new Set(
    [...body.matchAll(/\\cite\{([^}]+)\}/gu)]
      .flatMap((match) => match[1].split(',').map((key) => key.trim())),
  );
  const defined = new Set(
    [...refs.matchAll(/\\bibitem\{([^}]+)\}/gu)].map((match) => match[1].trim()),
  );

  const dangling = [...cited].filter((key) => !defined.has(key));
  assert.deepEqual(dangling, [], `citations with no reference entry: ${dangling.join(', ')}`);
});

test('INV-1 every reference is actually cited', () => {
  const body = read(PROPOSAL_BODY);
  const refs = read(PROPOSAL_REFS);
  if (!body || !refs) return;

  const cited = new Set(
    [...body.matchAll(/\\cite\{([^}]+)\}/gu)]
      .flatMap((match) => match[1].split(',').map((key) => key.trim())),
  );
  const defined = [...refs.matchAll(/\\bibitem\{([^}]+)\}/gu)].map((match) => match[1].trim());

  // A reference nobody cites is decoration, and decoration invites the question
  // "did you actually read this?"
  const orphans = defined.filter((key) => !cited.has(key) && key !== 'guidebook' && key !== 'uupdp' && key !== 'competitors2026');
  assert.deepEqual(orphans, [], `references never cited in the body: ${orphans.join(', ')}`);
});

test('INV-1 headline statistics carry a citation nearby', () => {
  const body = read(PROPOSAL_BODY);
  if (!body) return;

  // Each of these is an external claim about the world. If we state it, we cite it.
  const headlineFacts = ['9,949,502', '8,281,591', '37,459', '2,511'];
  const lines = body.split(/\r?\n/u);

  for (const fact of headlineFacts) {
    const index = lines.findIndex((line) => line.includes(fact));
    assert.notEqual(index, -1, `headline statistic ${fact} disappeared from the proposal`);
    // Look in the surrounding sentence, not just the same line, because LaTeX wraps.
    const window = lines.slice(Math.max(0, index - 2), index + 4).join(' ');
    assert.ok(
      /\\cite\{/u.test(window),
      `INV-1: statistic ${fact} is stated without a citation nearby. `
      + 'A number a judge cannot verify is a number a judge can discount.',
    );
  }
});

// ---------------------------------------------------------------------------
// INV-2  Never claim a capability the build does not have.
//        The analyzer is deterministic cue matching. Saying otherwise in the
//        product is the single fastest way to lose a judge in live Q&A.
// ---------------------------------------------------------------------------

const OVERCLAIMS = [
  /\bAI[-\s]powered\b/iu,
  /\bpowered by AI\b/iu,
  /\bconfidence score\b/iu,
  /\bability score\b/iu,
  /\bfluency score\b/iu,
  /\bunderstands? your (?:meaning|argument|intent)\b/iu,
  /\bguarantees?\b/iu,
  /\b100% accurate\b/iu,
  /\bstate[-\s]of[-\s]the[-\s]art\b/iu,
];

test('INV-2 the product never overclaims what the analyzer does', () => {
  for (const relative of PRODUCT_SURFACES) {
    const source = read(relative);
    if (!source) continue;
    const lines = source.split(/\r?\n/u);
    for (const [number, line] of lines.entries()) {
      for (const pattern of OVERCLAIMS) {
        assert.ok(
          !pattern.test(line),
          `${relative}:${number + 1} overclaims capability (${pattern}); `
          + 'the analyzer is deterministic cue matching. Describe what it does, not what it evokes.',
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// INV-3  Every verdict cites the evidence behind it.
//        This is the product's differentiator. If a verdict can reach a user
//        with nothing to point at, the differentiator is a slogan.
// ---------------------------------------------------------------------------

test('INV-3 no criterion verdict is returned without traceable evidence', () => {
  const result = analyzeSpeech({
    transcript: STARTER_DRAFT,
    rubricText: DEFAULT_RUBRIC,
    durationSeconds: 90,
  });

  for (const criterion of result.criteria) {
    const hasSupport = criterion.excerpt.length > 0;
    const hasGap = criterion.missingSignals.length > 0;
    assert.ok(
      hasSupport || hasGap,
      `criterion "${criterion.label}" produced a verdict with neither a transcript `
      + 'excerpt nor a list of missing cues. Every verdict must be traceable.',
    );
    // A "covered" verdict must point at the sentence that covers it.
    if (criterion.status === 'covered') {
      assert.ok(
        criterion.excerpt.length > 0,
        `criterion "${criterion.label}" is marked covered but cites no transcript span`,
      );
    }
  }
});

test('INV-3 the weakest criterion always drives the judge question', () => {
  const result = analyzeSpeech({
    transcript: STARTER_DRAFT,
    rubricText: DEFAULT_RUBRIC,
    durationSeconds: 90,
  });
  const lowest = Math.min(...result.criteria.map((criterion) => criterion.score));
  assert.equal(result.weakest.score, lowest, 'judge question is not grounded in the weakest claim');
  assert.ok(result.judgeQuestion.length > 30, 'judge question is too thin to rehearse against');
});

// ---------------------------------------------------------------------------
// INV-4  Boundaries are stated, never hidden.
//        Disclosed limits cost nothing. Discovered limits cost the round.
// ---------------------------------------------------------------------------

test('INV-4 the product states what its analysis is not', () => {
  const markup = read('index.html');
  if (!markup) return;
  assertContains(
    markup,
    /not\s+confidence\s+or\s+speaking\s+ability/iu,
    'INV-4: the review screen must state that evidence coverage is not a confidence '
    + 'or ability score. That sentence is why no judge accused us of overclaiming.',
  );
});

test('INV-4 the proposal states its honest boundary', () => {
  const body = read(PROPOSAL_BODY);
  if (!body) return;
  assertContains(
    body,
    /deterministic\s+cue\s+matching/iu,
    'INV-4: the proposal must disclose that current analysis is deterministic, not '
    + 'semantic. Disclosed limits cost nothing; discovered limits cost the round.',
  );
});

// ---------------------------------------------------------------------------
// INV-5  User content is rendered as text, never as markup.
//        One XSS in a live demo is a critical bug in front of judges.
// ---------------------------------------------------------------------------

test('INV-5 user-supplied content is never assigned as HTML', () => {
  for (const relative of ['src/app.mjs']) {
    const source = read(relative);
    if (!source) continue;
    const lines = source.split(/\r?\n/u);
    for (const [number, line] of lines.entries()) {
      assert.ok(
        !/\.innerHTML\s*=/u.test(line),
        `${relative}:${number + 1} assigns innerHTML. Rubric and transcript text is `
        + 'user input; render it with textContent.',
      );
      assert.ok(
        !/insertAdjacentHTML|outerHTML\s*=/u.test(line),
        `${relative}:${number + 1} injects markup. Use textContent or createElement.`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// INV-6  Scope stays explicitly bounded.
//        The out-of-scope list is what stopped "this is too broad" in round 1.
// ---------------------------------------------------------------------------

test('INV-6 the proposal still declares what is out of scope', () => {
  const body = read(PROPOSAL_BODY);
  if (!body) return;
  assertContains(
    body,
    /out\s+of\s+scope/iu,
    'INV-6: the MVP table must keep an explicit out-of-scope row. Bounded scope is '
    + 'why the feasibility argument held.',
  );
});

// ---------------------------------------------------------------------------
// INV-7  Analysis fails loudly, never silently.
//        A silent wrong answer on stage is worse than a visible error.
// ---------------------------------------------------------------------------

test('INV-7 invalid input raises a typed error instead of guessing', () => {
  assert.throws(
    () => analyzeSpeech({ transcript: '', rubricText: DEFAULT_RUBRIC, durationSeconds: 10 }),
    /Paste a transcript/u,
    'empty transcript must fail loudly',
  );
  assert.throws(
    () => analyzeSpeech({ transcript: 'x', rubricText: '', durationSeconds: 10 }),
    /rubric criterion/u,
    'missing rubric must fail loudly rather than analysing against nothing',
  );
  assert.throws(
    () => analyzeSpeech({ transcript: 'x', rubricText: DEFAULT_RUBRIC, durationSeconds: 0 }),
    /greater than zero/u,
    'invalid duration must fail loudly',
  );
});
