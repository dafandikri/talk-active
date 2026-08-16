# Talk-Active — Agent Instructions

> The canonical, model-agnostic instruction file. Tool-specific files (`CLAUDE.md`,
> `GEMINI.md`, `QWEN.md`) point here. This file is the project's memory; `harness update`
> will never overwrite it.

## What this is

Talk-Active is a rubric-grounded rehearsal and judge Q&A workspace for Indonesian university
students. A student creates a project, gives it the rubric they will actually be scored
against, rehearses — as a continuous presentation or as a fixed interview — and gets back, per
criterion, the exact span of their own words that supplies the evidence, or the explicit list
of what is missing. Then the hardest follow-up question an evaluator would ask, and a stronger
form of their answer built only from what they already said.

The differentiating loop is **project → rubric → attempt → evidence → hardest question → saved
progress.** Everything else is in service of it.

It was built for the RISTEK Hackathon 2026 Innovation Week and placed 2nd in the preliminary
round. That round is over. The event record is archived in
[`docs/TECHNICAL-MEETING-2026.md`](docs/TECHNICAL-MEETING-2026.md) and the sprint plan in
[`docs/specs/2026-08-10-innovation-week.md`](docs/specs/2026-08-10-innovation-week.md); neither
is a live plan. **The active plan is
[`docs/specs/2026-08-16-post-hackathon-design.md`](docs/specs/2026-08-16-post-hackathon-design.md).**
Scope changes are made by editing that file in a commit, never by informal agreement.

---

# THE INVARIANTS

**These are law. They are enforced by `pnpm check`, and `pnpm check` must pass before any work
is merged. Do not weaken a test to make it pass — fix the work.**

## Why these exist

They were not written from taste. They were written from a scoreboard.

Three judges scored this project 91.90 / 91.73 / 91.30 — a spread of **0.60, the smallest in
the field.** First place spread 1.20; the worst spread 11.58. Six teams beat our best single
score at least once and five of them finished below us. One team took a 94.20 from one judge
and still lost, because another judge gave them 88.25.

**In a multi-judge mean, your floor ranks you, not your ceiling.** The result did not come from
brilliance. It came from giving no evaluator a reason to mark the work down. Each invariant
below removes one such reason.

That argument still holds outside a competition, because the same property is what makes the
product trustworthy: a user who catches the tool overstating once discounts everything else it
says. Keep the reasoning attached. An invariant presented without its argument reads as
arbitrary, and arbitrary rules are the ones a tired contributor quietly weakens at 2am.

| | Invariant | Enforced by |
|---|---|---|
| **INV-1** | Every external fact is traceable to a source. | `test/invariants.test.mjs` |
| **INV-2** | Never claim a capability the build does not have. | `test/invariants.test.mjs` |
| **INV-3** | Every verdict cites the evidence behind it. | `test/invariants.test.mjs` |
| **INV-4** | Boundaries are stated, never hidden. | `test/invariants.test.mjs` |
| **INV-5** | User content is rendered as text, never as markup. | `test/invariants.test.mjs` |
| **INV-6** | Scope stays explicitly bounded. | `test/invariants.test.mjs` |
| **INV-7** | Analysis fails loudly, never silently. | `test/invariants.test.mjs` |
| **INV-8** | The demo path cannot break. | `e2e/production-ui/` |

### INV-1 — Every external fact is traceable to a source
A number nobody can verify is a number anybody can discount. Every statistic carries a
citation; every citation resolves to a real reference; every reference is actually cited. If
you cannot source it, cut it.

### INV-2 — Never claim a capability the build does not have
The analyzer is deterministic cue matching until the day it is not. The product must not say
"AI-powered", "confidence score", "understands your argument", or "guarantees". Describe what
it does, not what it evokes. Overclaiming fails the moment someone says "show me".

### INV-3 — Every verdict cites the evidence behind it
No criterion verdict reaches a user without either the transcript span that supports it or the
explicit list of cues that are missing. This is the entire differentiator. A verdict with
nothing to point at turns "rubric-grounded" into a slogan.

This is also why quoted spans are quoted, never regenerated: an excerpt is rendered as a
blockquote attributed to the speaker, so any transformation of it puts words in their mouth.
`findGroundedSpan` enforces the exact-substring property, and segmentation must preserve it.

### INV-4 — Boundaries are stated, never hidden
Disclosed limits cost nothing. Discovered limits cost trust. The review screen says evidence
coverage is *not* a confidence or ability score. The proposal says the analysis is
deterministic. Keep both sentences alive.

### INV-5 — User content is rendered as text, never as markup
Rubric criteria and transcripts are user input. `textContent` only — never `innerHTML`,
`outerHTML`, or `insertAdjacentHTML`.

### INV-6 — Scope stays explicitly bounded
Body-language scoring, streaks, generic speaking drills, institutional dashboards, and any
score presented as a measure of the speaker stay out.

**Amended 13 August 2026.** This line previously read "any numeric ability score". The
multimodal work shows a summary figure over the observations from one attempt, so the boundary
is drawn around the claim rather than the arithmetic. A number may describe what was observed
in a single rehearsal. It may not describe the person. Any such figure has to name its own
weighting, show each component with its evidence, and say what it could not measure, beside the
number and not behind a link. The moment a summary reads as a rating of the speaker, it is back
out of scope.

### INV-7 — Analysis fails loudly, never silently
Invalid input raises a typed error. A silent wrong answer is worse than a visible one, because
nobody recovers from what they did not notice.

### INV-8 — The demo path cannot break
`e2e/production-ui/` drives a real browser through the full sequence — cold start, practice,
analyse, defend, save, reload — against a production build, and fails on **any** console error,
uncaught exception, empty verdict card, lost state, or resource loaded from outside our own
origin.

**Corrected 13 August 2026.** This invariant used to name a demo script. That script went out
with the vanilla build on 12 August and nothing replaced the reference, so for a day INV-8
pointed at a file that did not exist. The browser suite had quietly taken the job over. An
invariant nobody can run is not enforced.

**Corrected 16 August 2026.** The same dead command survived in the pull request template, and
`test/harness-integration.test.mjs` asserted that it did — so the harness enforced a false
statement about itself for four days. A test that asserts a document contains a string will
stay green long after the thing the string names is gone. Every `pnpm` command named in
`AGENTS.md`, `README.md`, and the PR template is now checked against `package.json` itself.

---

## Stack & conventions

- TypeScript and React on Next.js (App Router), Node.js 20+.
- pnpm. Every runtime dependency is one somebody has to defend: Drizzle and Neon Postgres for
  persistence, Zod for the wire contract, the AI SDK and Gateway for the semantic tier, Upstash
  for the rate limiter that gates spend, better-auth for accounts, Vercel Blob for private
  replay storage, and one pinned vision package whose WASM and models are vendored same-origin.
- Start: `pnpm dev`. The browser gate builds and serves on `127.0.0.1:4183`.
- Pure domain logic lives in `apps/web/lib/`; DOM effects live in the components.
- `apps/web/lib/contracts.ts` is the one boundary. Route handlers parse with its schemas and
  components consume its inferred types. A parallel interface declaration is a drift bug.

### Commands

| Command | What it does |
|---|---|
| `pnpm check` | **The gate.** Unit tests, invariants, production typecheck and build, real-browser interaction, artifact health. The only definition of done. |
| `pnpm test` | Unit and invariant tests alone. Fast; run constantly. |
| `pnpm test:production:browser` | The browser walk-through alone. Serves the **existing** build — run `pnpm build` first if you changed anything the client renders. |
| `pnpm typecheck` | Types only. |
| `pnpm golden:capture` | Rewrites the analyzer baseline. Deliberate acts only; see below. |
| `pnpm project` | Compact agent-facing project context (TOON). |
| `pnpm rubric` · `pnpm finals` | Scorecard and the strict readiness gate. Historical; both relate to the finished event. |
| `pnpm check:proposal` | Rebuilds and verifies the proposal PDF (needs `tectonic`). |

### The golden baseline

`test/fixtures/golden-path.json` records what the analyzer does, so "did that change anything?"
is answered by a diff instead of a discussion. `pnpm golden:capture` overwrites it. That is
both the point and the danger: running it makes a failing `golden-path.test.mjs` disappear
without fixing anything. Regenerate only when you have decided a behaviour change is correct,
and say so in the commit message alongside the diff.

---

## Working method

You are crew; the human is the captain. Translate intent into shippable work, surface
trade-offs, and keep the captain on strategy.

1. **Plan before building.** For any non-trivial change, write a short plan and get agreement.
2. **Test first.** Write the test, watch it fail for the reason you expect, then implement.
3. **Validate before declaring done.** Run `pnpm check`. Evidence before claims — never report
   something as working that you have not seen pass.
4. **Small commits, merged often.** Write real commit messages explaining *why*.
5. **Isolate parallel work** in git worktrees.

The detailed agent architecture is [`docs/AGENT-WORKFLOW.md`](docs/AGENT-WORKFLOW.md): start
with the simplest composable workflow, expose checkpoints, read ground truth from tools and
tests, and give every autonomous loop an explicit stop condition.

### Rules of engagement

1. **`pnpm check` before every push.** Red does not merge.
2. **Never weaken a test to go green.** Fix the work, or change the invariant deliberately in
   this file, with agreement, and say so in the commit.
3. **Feature-flag anything risky.** The semantic tier ships behind a capability check with the
   deterministic path as fallback, so a failed API call degrades instead of dying.
4. **Green `pnpm check` is the permission to merge.** It is the coordination mechanism, which is
   what lets people work in parallel without a bottleneck.

---

## Product invariants

- The differentiating loop is project → rubric → attempt → evidence → hardest question → saved
  progress.
- Feedback is formative and traceable; never claim an objective confidence or ability score. A
  summary figure describes one rehearsal, never the speaker, and always carries its weighting,
  its per-component evidence, and what went unmeasured.
- Delivery metrics are supporting context. Rubric evidence stays the headline: a delivery
  reading never changes a criterion verdict, and no delivery figure outranks the evidence card.
- **The project's language governs what the user reads, not the transcript's.** A project is
  `id-ID` by default. Indonesian is the base case and English is the exception — not the other
  way round. Quoted material is never translated: a cited span is the speaker's own words and a
  cue is the author's own rubric text.
- Camera-and-microphone replay is persisted only after explicit opt-in, signed-in ownership
  checks, private storage, expiry metadata, and an independent delete control.
- Every capture signal is consented separately. Camera, microphone, dictation, and saved replay
  are four independent choices, and none of them implies another.

## Guardrails

- **Never auto-run git operations** (commit/push/PR) unless the captain asks.
- **Never name an AI tool or agent as a commit author, co-author, or repository collaborator.**
  No AI `Co-Authored-By` trailers. Disclose assistance through the designated originality
  statement instead.
- Keep this file lean. Task-specific detail belongs in skills, not here.
- Preserve `docs/Guidebook Registration RISTEK Hackathon.pdf` as the authoritative source.

## Skills

- `captains-workflow` — route non-trivial changes through plan → build → validate → deliver.
- `axi` — apply when changing `scripts/project.mjs` or another agent-facing command.
- `browser` — local visual and interaction QA.
- `humanizer` — before any user-facing prose ships.
