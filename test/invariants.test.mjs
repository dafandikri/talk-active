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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_RUBRIC, STARTER_DRAFT, analyzeSpeech } from '../apps/web/lib/analyzer.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

function sourceFilesUnder(relative, extensions = new Set(['.ts', '.tsx'])) {
  const start = join(ROOT, relative);
  if (!existsSync(start)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if ([...extensions].some((extension) => entry.name.endsWith(extension))) {
        files.push(absolute.slice(ROOT.length + 1));
      }
    }
  };
  visit(start);
  return files.sort();
}

// LaTeX and HTML wrap freely, so phrase checks must ignore how the source is
// line-broken. Collapsing whitespace keeps these tests about meaning, not layout.
const flat = (text) => text.replace(/\s+/gu, ' ');

// assert.match dumps the entire file into the failure output, which makes the
// gate unreadable at 2am. Report the rule that broke instead.
function assertContains(text, pattern, message) {
  assert.ok(pattern.test(flat(text)), message);
}

// Files that make claims to a user or an evaluator.
const NEXT_PRODUCT_SURFACES = [
  ...sourceFilesUnder('apps/web/app'),
  ...sourceFilesUnder('apps/web/components'),
];
// The vanilla ES-module build was deleted on 12 August once production had
// been serving the Next.js app for a full verification pass. Its entries lived
// here; removing them without putting the Next surfaces in their place would
// have left all eight invariants enforced over nothing, silently — which is
// the failure this file exists to prevent, applied to itself.
const PRODUCT_SURFACES = [
  ...NEXT_PRODUCT_SURFACES,
  'apps/web/lib/analyzer.ts',
];
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

// The entry route is the fast guest path. It must not imitate authentication:
// passwords belong only to the Better Auth-backed account route. This removes
// the ambiguity instead of trying to explain a fake sign-in after the fact.
test('INV-2 the guest entry never collects credentials and routes sync to real auth', () => {
  const gate = read('apps/web/components/entry-gate.tsx');
  if (!gate) return;

  assert.doesNotMatch(gate, /type=["']password["']/iu,
    'the local guest route must never collect a password');
  assert.doesNotMatch(gate, /authClient\.(?:signIn|signUp)/u,
    'authentication calls belong to the real account surface');
  assert.match(gate, /href=["']\/account["']/u,
    'the optional sync path must route to the Better Auth-backed account surface');
  assert.match(gate, /stay in this browser/iu,
    'the guest path must state its local-storage boundary');
});

const AUTHENTICATION_CLAIMS = [
  /\bsign[-\s]?in(?:g)?\b/iu,
  /\bsign[-\s]?up\b/iu,
  /\blog[-\s]?in\b/iu,
  /\bcreate an account\b/iu,
  /\byour account\b/iu,
  /\bpassword\b/iu,
];

// Everywhere that is not the entry screen or the real account page still has
// no business implying an account exists.
test('INV-2 account language stays on the screens that own it', () => {
  const owners = new Set([
    'apps/web/components/entry-gate.tsx',
    'apps/web/components/account-panel.tsx',
    'apps/web/app/(auth)/enter/page.tsx',
    'apps/web/app/(workspace)/account/page.tsx',
  ]);
  for (const relative of PRODUCT_SURFACES) {
    const ownerPath = relative.replaceAll('\\', '/');
    if (owners.has(ownerPath)) continue;
    const source = read(relative);
    if (!source) continue;
    for (const [number, line] of source.split(/\r?\n/u).entries()) {
      for (const pattern of AUTHENTICATION_CLAIMS) {
        assert.ok(
          !pattern.test(line),
          `${relative}:${number + 1} implies authentication (${pattern}); `
          + 'the deployed vanilla display name is a local label, not an account.',
        );
      }
    }
  }

  const accountPanel = read('apps/web/components/account-panel.tsx');
  const authRoute = read('apps/web/app/api/auth/[...all]/route.ts');
  const authSchema = read('apps/web/lib/db/auth-schema.generated.ts');
  assertContains(accountPanel, /authClient\.signIn\.email/u, 'production sign-in must call Better Auth');
  assertContains(authRoute, /toNextJsHandler/u, 'production auth claims require a real Next.js handler');
  assertContains(authSchema, /password: text\("password"\)/u, 'password auth requires generated credential storage');
});

// A workspace that greets every booth visitor by one teammate's name is
// telling them something false about whose device they are holding.
test('INV-2 the workspace does not ship a hardcoded personal identity', () => {
  const frame = read('apps/web/components/workspace-frame.tsx');
  if (!frame) return;
  assert.ok(
    !/["'>]\s*(?:Dafa|DF)\s*[<"']/u.test(frame),
    'the profile chip hardcodes a personal name; render it from the stored identity instead.',
  );
  assert.match(
    frame,
    /readGuestIdentity/u,
    'the profile chip must read the current rehearser rather than ship a fixed name.',
  );
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
  const markup = read('apps/web/components/practice-room.tsx');
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
  for (const relative of NEXT_PRODUCT_SURFACES) {
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
      assert.ok(
        !/dangerouslySetInnerHTML/u.test(line),
        `${relative}:${number + 1} uses dangerouslySetInnerHTML. React text nodes already escape user content.`,
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

// ---------------------------------------------------------------------------
// INV-4  Delivery coaching is real, and bounded.
//        Filler and pace feedback is genuinely useful, but it is the second
//        thing on the review screen, not the product. The moment it reads as a
//        score, we are selling the generic speaking-coach we said we are not.
// ---------------------------------------------------------------------------
test('INV-4 delivery coaching names its own limit and stays subordinate to evidence', () => {
  const room = read('apps/web/components/practice-room.tsx');
  if (!room) return;

  assertContains(
    room,
    /not a measure of speaking ability/u,
    'the delivery panel must state that it does not measure speaking ability',
  );
  assertContains(
    room,
    /does not change the rubric evidence/u,
    'the delivery panel must state that it does not affect the rubric verdicts',
  );

  // Position encodes priority. If delivery ever moves above the evidence map,
  // the screen starts arguing that HOW you spoke matters more than WHETHER you
  // supported the criterion, which inverts the entire product thesis.
  const evidenceAt = room.indexOf('Rubric evidence map');
  const deliveryAt = room.indexOf('delivery-section');
  assert.ok(evidenceAt !== -1 && deliveryAt !== -1, 'both the evidence map and the delivery panel must exist');
  assert.ok(
    evidenceAt < deliveryAt,
    'the delivery panel must stay below the rubric evidence map; position is what keeps it supporting context',
  );
});

test('INV-2 filler feedback is written out, not reduced to a grade', () => {
  const app = read('apps/web/components/practice-room.tsx');
  if (!app) return;

  // "7 fillers" is a number a student cannot practise against. The individual
  // words are the actionable part, so the code must actually render them.
  assertContains(app, /filler\.label/u, 'each filler word must be rendered by name, not just counted');
  assertContains(app, /filler\.count/u, 'each filler word must carry its own count');

  // A grade on delivery is exactly the ability score INV-2 forbids.
  for (const forbidden of [/delivery\s*score/iu, /speaking\s*score/iu, /fluency\s*score/iu]) {
    assert.ok(!forbidden.test(app), `delivery feedback must not be presented as a score (${forbidden})`);
  }
});
