# Talk-Active — Agent Instructions

> Scaffolded by agent-harness. This is the canonical, model-agnostic instruction file.
> Tool-specific files (`CLAUDE.md`, `GEMINI.md`, …) point here. Edit this file to make it
> yours — it is the project's memory. This file is **User Layer**: `harness update` will
> never overwrite it.

## What we're building

Talk-Active is a rubric-grounded rehearsal and judge Q&A workspace for Indonesian university
students. The current milestone is the RISTEK Hackathon 2026 Innovation Week build: a
working product that survives a live demo, with persistent projects, per-project rubrics,
multi-stage practice, grounded Q&A, and saved progress. It is not a landing-page demo or a
generic public-speaking scorecard.

**Standing:** 2nd of the field in the preliminary round (91.64). Finals are 14 August 2026.

**The active plan is [`docs/specs/2026-08-10-innovation-week.md`](docs/specs/2026-08-10-innovation-week.md).**
Read it before starting work. It holds the scope, the architecture decisions, the day-by-day
schedule, the task list with owners, and the risk register. Scope changes are made by editing
that file in a commit, never by informal agreement.

**The official technical-meeting record is [`docs/TECHNICAL-MEETING-2026.md`](docs/TECHNICAL-MEETING-2026.md).**
Read it for submission, event-day, pitch, exhibition, scoring, and penalty requirements. Its
source coverage and high-risk facts are enforced by `test/technical-meeting.test.mjs`.

**The enforced finals rubric is [`docs/rubrics/2026-finals.json`](docs/rubrics/2026-finals.json).**
Run `pnpm rubric` for the three-surface scorecard and `pnpm finals` for the strict,
evidence-backed product, presentation, and booth readiness gate. `pnpm check` prevents the
official weights, requirements, ownership, and evidence obligations from drifting.

---

# THE INVARIANTS

**These are law. They are enforced by `pnpm check`, and `pnpm check` must pass before any
work is merged, demoed, or submitted. Do not weaken a test to make it pass — fix the work.**

## Why these exist

The preliminary scoreboard is the evidence. Our three judge scores were 91.90 / 91.73 /
91.30 — a spread of **0.60, the smallest in the entire field** (first place: 1.20; the worst:
11.58). Six teams beat our best single-judge score at least once. Five of them finished
below us. One team scored a 94.20 from one judge and still lost, because another judge gave
them 88.25.

**In a multi-judge mean, your floor ranks you, not your ceiling.** We did not win on
brilliance. We won by giving no evaluator a reason to mark us down. Every invariant below
removes one such reason. That is the property we are protecting, and it is the property that
has to survive four days of sleep-deprived sprinting.

| | Invariant | Enforced by |
|---|---|---|
| **INV-1** | Every external fact is traceable to a source. | `test/invariants.test.mjs` |
| **INV-2** | Never claim a capability the build does not have. | `test/invariants.test.mjs` |
| **INV-3** | Every verdict cites the evidence behind it. | `test/invariants.test.mjs` |
| **INV-4** | Boundaries are stated, never hidden. | `test/invariants.test.mjs` |
| **INV-5** | User content is rendered as text, never as markup. | `test/invariants.test.mjs` |
| **INV-6** | Scope stays explicitly bounded. | `test/invariants.test.mjs` |
| **INV-7** | Analysis fails loudly, never silently. | `test/invariants.test.mjs` |
| **INV-8** | The demo path cannot break. | `scripts/demo-gate.mjs` |

### INV-1 — Every external fact is traceable to a source
A number an evaluator cannot verify is a number an evaluator can discount. Every statistic
carries a citation; every citation resolves to a real reference; every reference is actually
cited. If you cannot source it, cut it.

### INV-2 — Never claim a capability the build does not have
The analyzer is deterministic cue matching until the day it is not. The product must not say
"AI-powered", "confidence score", "understands your argument", or "guarantees". Describe what
it does, not what it evokes. Overclaiming is the fastest way to lose a judge in live Q&A,
because the follow-up question is always "show me".

### INV-3 — Every verdict cites the evidence behind it
No criterion verdict reaches a user without either the transcript span that supports it or
the explicit list of cues that are missing. This is the entire differentiator. A verdict with
nothing to point at turns "rubric-grounded" into a slogan.

### INV-4 — Boundaries are stated, never hidden
Disclosed limits cost nothing. Discovered limits cost the round. The review screen says
evidence coverage is *not* a confidence or ability score. The proposal says the analysis is
deterministic. Keep both sentences alive.

### INV-5 — User content is rendered as text, never as markup
Rubric criteria and transcripts are user input. `textContent` only — never `innerHTML`,
`outerHTML`, or `insertAdjacentHTML`. One injection during a live demo is a critical bug in
front of judges.

### INV-6 — Scope stays explicitly bounded
The out-of-scope list is why the feasibility argument held. Body-language scoring, streaks,
generic speaking drills, institutional dashboards, and any numeric ability score stay out
until the core loop is validated. Adding scope during a four-day sprint is how demos break.

### INV-7 — Analysis fails loudly, never silently
Invalid input raises a typed error. A silent wrong answer on stage is worse than a visible
one, because you cannot recover from what you did not notice.

### INV-8 — The demo path cannot break
`scripts/demo-gate.mjs` runs the exact sequence a judge watches — cold start, practice,
analyse, defend, save, reload — and fails on **any** console error, uncaught exception, empty
verdict card, lost state, or resource loaded from outside our own origin. Run it before every
mentoring session and before you sleep.

---

## Stack & conventions

- Language / framework: semantic HTML, CSS, and native JavaScript ES modules on Node.js 20+.
- Package manager: pnpm. The product prototype intentionally has zero runtime dependencies.
- Start: `pnpm dev` (local allow-listed server on `127.0.0.1:4173`).
- **Gate: `pnpm check`** — unit tests, invariants, HTTP security, real-browser interaction,
  the demo gate, and artifact health. This is the only definition of "done".
- `pnpm demo` — the demo gate alone. Fast. Run it constantly.
- `pnpm check:proposal` — rebuilds and re-verifies the proposal PDF (needs `tectonic`).
- Agent context: `pnpm project` (compact TOON output).
- Prefer pure domain logic in `src/analyzer.mjs`; keep DOM effects in `src/app.mjs`.

---

## How five people ship in four days

The gate is the coordination mechanism. Nobody needs permission to merge; **green `pnpm check`
is the permission.** That is what lets five people work in parallel without a bottleneck.

### Ownership (one owner per scoring block, so nothing is nobody's job)

| Owner | Owns | Points defended |
|---|---|---|
| **Demo owner** | `scripts/demo-gate.mjs` stays green. Has veto on any merge within 12h of a demo. | Technical Execution 30 · Interactive Demo 30 |
| **Core logic** | `src/analyzer.mjs`. Semantic evidence mapping behind a flag, deterministic fallback always intact. | Innovation & Uniqueness 10 · data-flow 10 |
| **Interface** | `src/app.mjs`, `src/styles.css`, booth display. | Design & UX 10 · Booth & Visual 20 |
| **Pitch** | 7-minute script, deck, Q&A drilling. Rehearses *using Talk-Active against the finals rubric*. | Pitching & Q&A 20 · Communication 30 |
| **Integration** | Keeps `main` green, owns merges, runs the gate, exhibition logistics. | every block |

Roles are ownership, not walls. Anyone may edit anything; the owner is who answers for it.

### Rules of engagement

1. **Small commits, merged often.** A four-day sprint dies on a three-day branch.
2. **`pnpm check` before every push.** If it is red, it does not merge. No exceptions at 2am —
   that is exactly when the rule earns its keep.
3. **Never weaken a test to go green.** Fix the work, or change the invariant deliberately in
   this file with the team's agreement. A silently disabled test is a lost point on the 14th.
4. **Feature-flag anything risky.** Semantic analysis ships behind a flag with the
   deterministic path as fallback, so a failed API call degrades instead of dying.
5. **Freeze at 13 August, 18:00.** After the freeze: bug fixes only, and only if `pnpm check`
   stays green. The official submission deadline is 13 August at 18.00 WIB; submit earlier.
6. **Rehearse on the real machine.** The demo laptop, the real screen, once per day from Day 2.

### Making strengths visible

- **Say what you own at the start of each day** in one line, so nobody duplicates work.
- **Demo to each other before demoing to mentors.** The four mentoring sessions (Days 1–4,
  19.00) are free evaluator feedback — bring a working build, not slides.
- **Log every mentor question.** Those are your Q&A rehearsal set; feed them into Talk-Active
  as rubric criteria and practise against them.

### Attendance is a scored requirement, not a formality

Mentoring sessions run Days 1–4 at 19.00 and require **⌊N/2⌋+1 members present**. For a
five-person team that is **minimum 4 people every session**. Missing the offline exhibition
or pitching on 14 August is automatic disqualification.

---

## Working method

You are crew on this project; the human is the captain. Translate intent into shippable work,
surface trade-offs, and keep the captain focused on strategy.

1. **Plan before building.** For any non-trivial change, write a short plan first.
2. **Validate before declaring done.** Run `pnpm check`. Evidence before claims — never report
   something as working that you have not seen pass.
3. **Isolate parallel work** in git worktrees; coordinate multi-agent work through `firstmate`.

The detailed agent architecture is [`docs/AGENT-WORKFLOW.md`](docs/AGENT-WORKFLOW.md): start
with the simplest composable workflow, expose checkpoints, read ground truth from tools and
tests, and give every autonomous loop an explicit stop condition.

## Skills

- `captains-workflow` — route non-trivial changes through plan → build → validate → deliver.
- `axi` — apply when changing `scripts/project.mjs` or another agent-facing command.
- `browser` — local visual and interaction QA.
- `humanizer` — before any evaluator-facing prose ships.

## Product invariants

- The differentiating loop is project → rubric → attempt → evidence → hardest question → saved progress.
- Feedback is formative and traceable; never claim an objective confidence or ability score.
- Delivery metrics are supporting context, not the core value proposition.
- Camera-and-microphone replay is persisted only after explicit opt-in, signed-in ownership
  checks, private storage, expiry metadata, and an independent delete control.

## Guardrails

- Never auto-run git operations (commit/push/PR) unless the captain asks.
- Never name an AI tool or agent as a commit author, co-author, or repository
  collaborator. Do not add AI `Co-Authored-By` trailers; disclose assistance
  through the designated originality statement instead.
- Keep this file lean. Move task-specific detail into skills, not here.
- Preserve `docs/Guidebook Registration RISTEK Hackathon.pdf` as the authoritative source.
- Disclose AI assistance accurately: the originality statement covers "misrepresentation of
  AI usage". Confirm the organizer's policy before the final submission.
