# Handover — 2026-08-12

**Read `AGENTS.md` first.** The invariants there are law and `pnpm check` enforces them.
This file is the current state and the next actions.

**Deadlines:** submission 13 Aug 18:00 WIB (hard freeze) · finals 14 Aug.

---

## Build state: healthy, every gate green

Verified on `main` @ `919cd47`, 2026-08-12:

| Gate | Result |
|---|---|
| `node --test` | 130/130 |
| `scripts/browser-check.mjs` | 14/14 |
| `scripts/demo-gate.mjs` | 9/9, empty console |
| `scripts/project.mjs check` | 19/19 artifacts |
| `scripts/finals-rubric.mjs check` | passes |
| **`pnpm check`** | **green end to end** |
| `pnpm finals` (`finals-rubric gate`) | **0/28 — evidence unfilled, not a code problem** |

Security audited clean: no secrets tracked or in git history, zero `innerHTML` anywhere
(INV-5 holds), strict CSP with no `unsafe-inline`.

---

## Everything below is UNCOMMITTED

```
docs/MENTORING/                          research outputs (AI layer, market validation)
docs/specs/2026-08-11-ai-layer.md        AI layer component spec
docs/specs/2026-08-11-backlog.md         who does what
docs/specs/2026-08-11-target-architecture.md
docs/specs/2026-08-12-positioning.md     URGENT — competitor finding
docs/specs/2026-08-12-validation-report.md
docs/superpowers/plans/2026-08-12-finals-hardening.md    backend/AI plan
docs/superpowers/plans/2026-08-12-booth-readiness.md     frontend plan
src/assets/macaw-mark.svg                new logo drafts, not yet wired in
src/assets/macaw-mark-white.svg
src/assets/macaw-favicon.svg
src/assets/Screenshot 2026-08-11 *.png   logo reference art
```

No source code has been modified. The two plans are written but **not started**.

---

## Do this first

**Task 1 of `docs/superpowers/plans/2026-08-12-finals-hardening.md`.** One line plus a test.

Per-attempt timeout is 12s and the chain budget 22s (`src/semantic.mjs:85-86`), but the client
aborts at 15s (`src/app.mjs:603`) and discards anything not `mode === 'semantic'` (`:613`).
Vendor 1 timing out plus vendor 2 succeeding always exceeds 15s, so **the multi-vendor failover
chain can only ever deliver from the first vendor.** The fallback path is structurally
unreachable, not merely slow.

Fix: raise the client timeout to 25s and add the guard test in the plan.

---

## The four verified defects

Read in source, not inherited from a report.

| ID | Defect | File |
|---|---|---|
| **P0-1** | Failover chain unreachable past vendor 1 (above) | `src/app.mjs:603` |
| **P0-2** | `spanIsGrounded` has no whitespace/punctuation normalisation, so a quote across a line break or with curly quotes discards a **correct** verdict | `src/semantic.mjs:165-169` |
| **P0-3** | Result badged `mode: 'semantic'` even when individual criteria fell back to cue matching. INV-2/INV-4 gap | `src/semantic.mjs:184-222` |
| **P0-4** | Spans under 12 chars can never ground — undocumented magic number | `src/semantic.mjs:166` |

**Withdrawn:** an earlier report claimed "partial fabrication passes." It does not. `:193`
already discards each ungrounded verdict individually; `:217` is a second whole-pass layer on
top. **Both layers are load-bearing — do not collapse them.**

---

## The missing feature

**A6 rubric import does not exist**, and the pitch stakes minute 4 on pasting the judges' own
scoring matrix. Tasks 5–7 of the hardening plan build it end to end: a pure module, an
endpoint, and the UI. It emits the existing `label | cues` line format, so `parseRubric` and
the data model are untouched.

---

## Urgent, non-code

**`docs/specs/2026-08-12-positioning.md` — read it before any deck work.**

Yoodli already ships user-supplied rubric import (Enterprise tier) and published a post making
our exact argument on 11 Aug 2026. The claim "no competitor evaluates against a user-supplied
rubric" is falsifiable in a two-minute search and must be retired. The document has the honest
replacement, plus three statistics that break under scrutiny (LPDP 6.7%, the n=27 anxiety
survey, SAM ~2.0M) and their sourced replacements.

---

## Rules that will fail the build if broken

- **`pnpm check` green before every push.** It is the merge permission.
- **Never weaken a test to go green.** Fix the work.
- **`textContent` only** — never `innerHTML`, `outerHTML`, `insertAdjacentHTML` (INV-5).
- **No new runtime dependencies.** The client is intentionally dependency-free.
- **Never claim a capability the build lacks** (INV-2). No "AI-powered", no confidence scores.
- **Never name an AI tool as commit author or co-author.** No `Co-Authored-By` trailers for
  assistants — the repo forbids it; disclose assistance through the originality statement.
- Branch per task: `p0-failover-timeout`, `a6-rubric-import`, `b3-kiosk-reset`. No branch
  outlives the day.

---

## Split

| | Owns | Plan |
|---|---|---|
| **Backend / AI** | `src/semantic.mjs`, `src/analyzer.mjs`, `api/`, `src/rubric-import.mjs` | `plans/2026-08-12-finals-hardening.md` |
| **Frontend** | `src/styles.css`, `index.html`, layout in `src/app.mjs` | `plans/2026-08-12-booth-readiness.md` |

Only `src/app.mjs` is shared, and the two plans touch different functions in it.

**Design and interaction flow are frozen** — visual appearance and screen sequence must not
change. Domain logic, persistence, and copy are open.

---

## Open

1. **Team availability is unknown.** The backlog assumes two full-time developers plus three
   part-available teammates. Re-cut §4 if that is wrong.
2. **`pnpm finals` is 0/28 and unowned.** Two entries need an email to the organiser today
   (`TM-OPEN-001` file naming, `TM-OPEN-002` AI-assistance policy) — they have lead time.
3. **The new macaw logo is not wired in.** `index.html:19` and `:61` still load
   `cockatoo-mark.svg`. The SVGs in `src/assets/macaw-*.svg` are token-accurate **drafts**
   needing an illustrator pass — see backlog BR-1..BR-7.
