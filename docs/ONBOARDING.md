# Onboarding — read this once, then start

Five people, four days, one deadline. This is how we work so nobody waits on
anybody and nothing gets lost.

## Setup (once, five minutes)

```bash
git clone https://github.com/dafandikri/talk-active.git
cd talk-active
pnpm install
pnpm setup:hooks        # installs the pre-push gate
gh auth login           # GitHub CLI, needed for the board commands
pnpm check              # should end green
pnpm dev                # http://127.0.0.1:4173
```

If `pnpm check` is red on a fresh clone, say so immediately — that means `main`
is broken and it is everyone's problem, not yours.

## The one rule

**`pnpm check` is the definition of done and the permission to merge.**

Green gate means merge. You do not need anyone's approval, and you should not
wait for it. That is the whole point: five people cannot afford a review
bottleneck in four days.

Red gate means it does not go in. Not "I'll fix it after", not at 2am, not
"it's only a small thing". The gate is what stops one tired mistake from
costing points on the 14th.

**Never weaken a test to go green.** If you believe an invariant is genuinely
wrong, change it in `AGENTS.md`, in its own commit, with the team's agreement.
A silently disabled test is a lost point.

## Your day

```bash
pnpm status             # where we are: who is on what, CI, countdown
pnpm take 6             # claim issue #6 — assigns you and makes a branch
# ... work ...
pnpm check              # green?
git push -u origin <branch>
gh pr create --fill --body "Closes #6"
```

`Closes #6` in the PR body closes the issue automatically when it merges. That
is the "automated tracking" — you never move a card by hand.

**WIP limit is 1.** `pnpm take` will stop you if you already have something
open. Finishing beats starting.

## How we see what is happening, in real time

| Question | Answer |
|---|---|
| Who is working on what? | `pnpm status`, or the Issues tab — an assignee means it is in progress |
| What should I pick up? | `pnpm status` prints unclaimed **demo-critical** issues first |
| Is `main` healthy? | `pnpm status` shows the last five CI runs. Also the ✓/✗ next to each commit on GitHub |
| Did my change break something? | CI runs `pnpm check` on every push and comments on the PR |
| How long left? | `pnpm status` counts down to submission and exhibition |

Nothing here needs a meeting. If you want the state, run the command.

## Test-driven, because the gate is unforgiving

The gate will fail you late if you write code first. So write the test first —
it is faster, not slower, when the gate is this strict.

1. **Write the failing test.** What should be true when this works?
2. **Watch it fail.** A test that has never failed proves nothing.
3. **Write the smallest code that passes it.**
4. **`pnpm check`.**

Real example from this repo: the semantic analysis fallback was written
test-first. Writing "every vendor down still returns a usable review" is what
exposed that a model fabricating *every* quote would have been reported as
successful semantic analysis. The test found a real bug in the design before
the code shipped.

Where tests live:

| File | Covers |
|---|---|
| `test/analyzer.test.mjs` | The deterministic domain logic |
| `test/semantic.test.mjs` | AI analysis, provider failover, the grounding rule |
| `test/invariants.test.mjs` | The eight invariants in `AGENTS.md` |
| `test/server.test.mjs`, `test/middleware.test.mjs` | HTTP boundaries |
| `scripts/demo-gate.mjs` | The exact flow judges will watch |

## What the gate actually runs

```
pnpm check
├── node --test              41 tests: domain, semantic, invariants, HTTP
├── browser-check.mjs        11 checks: the full product in a real browser
├── demo-gate.mjs            9 steps: the judge path, adversarially
└── project.mjs check        13 artifacts present and non-empty
```

Then the same command runs again in CI on every push. Same command, no CI-only
configuration to drift.

## Commit and PR style

Explain **why**, not what. The diff already says what.

```
Make availability a property of the system, not a hope

The model chain is now three vendors deep, because availability comes
from vendor diversity, not model diversity. Three models from one lab
share one outage.
```

Branch names come from `pnpm take`, so they already match the issue.

## Where the plan lives

| File | What it is |
|---|---|
| [`docs/specs/2026-08-10-innovation-week.md`](specs/2026-08-10-innovation-week.md) | The plan: scope, architecture decisions, day-by-day, all 24 tasks, risks |
| [`AGENTS.md`](../AGENTS.md) | The invariants. Law. Enforced by the gate |
| GitHub Issues | Live state. One issue per task |

Scope changes are edits to the spec, in a commit — never an informal agreement
in the group chat. If it is not written down, it is not the plan.

## Things that lose us points, ranked

1. A crash during the live demo — Technical Execution is 30 points
2. A visitor who cannot open the app — Interactive Demo is 30 points
3. Running past 7 minutes — the pitch is cut off, you lose your ending
4. Fewer than 4 of us at a 19.00 mentoring session — it is a scored requirement
5. Missing the 13 Aug 18.00 WIB submission deadline — late penalties begin immediately

## Ask early

Blocked more than 30 minutes? Say so in the group chat, then put the `blocker`
label on the issue. Nobody gets credit for being stuck quietly.
