# Talk-Active — Full Validation Report

**Run:** 2026-08-12 · **Against:** `main` @ `919cd47` · **Method:** every gate executed, every
claimed defect read in source before being recorded.

Verdict up front: **the shipping build is healthy and every automated gate passes.** What is
missing is not quality — it is *features that were never built* and *evidence that was never
filled in*. Those are the only two things standing between today and a finals-ready product.

---

## 1. Gate results — all green

**`pnpm check` passes end to end.** Every component was run individually:

| Gate | Part of | Result |
|---|---|---|
| `node --test` | `pnpm check` | **130/130 pass** |
| `scripts/browser-check.mjs` | `pnpm check` | **14/14 pass** (chrome-headless-shell) |
| `scripts/demo-gate.mjs` | `pnpm check` | **9/9 pass**, zero console output |
| `scripts/project.mjs check` | `pnpm check` | **19/19 required artifacts ready** |
| `scripts/finals-rubric.mjs check` | `pnpm check` | **passes** — 2 scorecards, 3 surfaces, 10 criteria, 18 requirements intact |
| `scripts/finals-rubric.mjs gate` | `pnpm finals` | **FAILS — 0/28 verified** |

The demo gate covers the exact judge path: cold-start → open-practice → begin-attempt →
analyse → **every-verdict-has-evidence** → defend → save-session → survives-reload →
no-external-dependencies. It passed with an empty console array.

**The two finals-rubric subcommands are not the same gate, and the difference matters.**
`check` (inside `pnpm check`) validates that the official weights, criteria, and requirements
have not drifted — it passes. `gate` (`pnpm finals`) demands *evidence* that each criterion is
actually satisfied — it fails at 0/28.

So: **the merge gate is green; the readiness gate is red.** `docs/finals-readiness.json` has
28 pending entries with no evidence attached, and nobody owns it. This is paperwork, not code
— which is exactly why it will keep being nobody's job until someone is named.

---

## 2. Security — clean

| Check | Result |
|---|---|
| Secrets tracked in git | **None.** Only `.env.example`. |
| Secrets anywhere in history | **None.** `git log --diff-filter=A` over all refs is clean. |
| API-key patterns in tracked source | **None.** (One grep hit was the substring in "kio**sk-**reset".) |
| `.gitignore` correctness | `.env*` ignored, `!.env.example` re-included. Ordering is correct — a prior commit fixed exactly this. |
| **INV-5** — `innerHTML` / `outerHTML` / `insertAdjacentHTML` | **Zero occurrences** across `src/`, `api/`, `index.html`, `brief.html`. The only match is a comment at `src/app.mjs:550` explaining the rule. |
| External resources in the product page | **None.** Self-contained, which is what makes the offline demo possible. |
| CSP (`vercel.json`) | Strict: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, and **no `unsafe-inline`** on either script or style. |

**`middleware.js` is correct and deliberate.** It is public by default — a credential prompt
would score zero on the exhibition's "easily accessible to visitors/judges" criterion — and
when `PRIVATE_DEPLOYMENT=1` is set without `SITE_PASSWORD` it returns 503 rather than serving
a site someone believes is protected. Comparison is constant-time over SHA-256 digests. This
is better than most production auth middleware and needs no change.

---

## 3. AI layer — defects verified in source

Every item below was read in the file before being recorded. **One previously-reported defect
did not survive that reading and has been withdrawn.**

### Confirmed

**P0-1 — the failover chain cannot reach the client past vendor 1.** This is worse than first
described. Per-attempt timeout is 12s and total chain budget 22s (`src/semantic.mjs:85-86`);
the client aborts at 15s (`src/app.mjs:603`) and discards anything not `mode === 'semantic'`
(`:613`). So vendor 1 timing out (12s) plus vendor 2 succeeding at any speed exceeds the
client's patience. **The multi-vendor failover chain — the product's headline resilience
feature — can only ever deliver a result from the first vendor.** It is not that slow results
are occasionally lost; the fallback path is structurally unreachable.

**P0-2 — grounding produces false negatives.** `spanIsGrounded` (`:165-169`) does
`.trim().toLowerCase()` then `includes()`, with no whitespace or punctuation normalisation. A
model quoting across a line break, or normalising curly quotes or dashes, has a **correct**
verdict silently discarded. This costs accuracy invisibly, in the direction of under-crediting
the student.

**P0-3 — per-criterion provenance is missing.** When a span fails grounding, `:193` correctly
drops that row to the deterministic criterion — but the response is still badged
`mode: 'semantic'` overall. A result can claim "semantic" while individual criteria were
cue-matched, with nothing on screen distinguishing them. **This is an INV-4 boundary that is
currently hidden and an INV-2 claim the build does not fully have.**

**P0-4 — undocumented magic number.** `spanIsGrounded` returns `false` for any span under 12
characters (`:166`). Defensible as a guard against trivial matches, but undocumented and
untested in the single most important function in the codebase.

### Withdrawn

**"Partial fabrication passes" — not a defect.** The claim was that `:217` rejects a pass only
when *zero* spans ground, so a response with some real and some invented quotes survives
intact. Reading the code properly: `:193` already discards each ungrounded supporting verdict
individually. The `claimedSupport > 0 && grounded === 0` check at `:217` is a **second,
whole-pass** layer on top. Per-verdict rejection already works correctly.

> Recorded because the error is instructive: this came from a research pass and was repeated
> without being read in source. Both layers are load-bearing and must survive the port.

---

## 4. Frontend — sound, and portable

- **48 functions across 1,047 lines** in `src/app.mjs` — roughly 22 lines each. Well
  decomposed for a single-file SPA; not the monolith the line count suggests.
- **Design system is stack-agnostic.** CSS custom properties in `src/tokens.css` (12k), with
  `src/styles.css` (66k) and `src/landing.css` (21k) consuming them. This is why the Next.js
  port can keep the visual design byte-identical instead of reinterpreting it — the tokens
  move unchanged.
- **`test/design-system.test.mjs` exists.** A test that enforces design rules is unusual and
  valuable: it is the mechanism that will *prove* the visual freeze held through the port,
  rather than relying on eyeballing.
- **Zero external resources.** Confirmed by grep and by the demo gate's
  `no-external-dependencies` step.

---

## 5. What is actually missing

Nothing here is a quality problem. Both items are unstarted work.

### 5.1 Features

| | Status | Impact |
|---|---|---|
| **A6 rubric import** — paste a scoring matrix, AI structures it | **Not built** | **This is the hero moment.** The pitch stakes minute 4 on pasting the judges' own matrix. |
| **B3 kiosk reset** | Not built | Booth visitors |
| **B6 demo gate covers semantic + fallback** | Not built | The fallback path is currently unproven end-to-end — and P0-1 shows why that matters |

### 5.2 Evidence

`docs/finals-readiness.json` — **0/28**. A scored gate, entirely unfilled, owned by nobody.

### 5.3 Ownership

`pnpm status` reports **17 open issues and nobody has claimed anything.** Six are
demo-critical. This is the largest single risk in the report, and it is not technical.

---

## 6. Conclusions

1. **The build does not need rescuing.** Every automated gate is green, security is clean, and
   the invariants hold. Effort should go to unbuilt features and unfilled evidence, not to
   hardening what already works.
2. **P0-1 is the highest-value fix in the repository.** It restores a resilience feature the
   product claims to have and currently cannot deliver, and it is a one-line change.
3. **P0-3 is the highest-*risk* item**, because it is an honesty gap rather than a bug — the
   kind a judge finds by asking "so which criteria did the AI actually judge?"
4. **The finals-readiness gate is the quietest risk.** It is scored, it is red, and it is
   nobody's job.
5. **Verify claims in source before acting on them.** One of four reported AI-layer defects
   did not exist. The gates in this repository are trustworthy; second-hand reports about
   them are not.
