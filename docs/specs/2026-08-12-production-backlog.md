# Talk-Active — Production backlog

**Date:** 2026-08-12 · **Scope:** everything after the hackathon. No time constraints.
**Why the architecture is settled:** [`2026-08-11-target-architecture.md`](2026-08-11-target-architecture.md),
[`2026-08-11-ai-layer.md`](2026-08-11-ai-layer.md), [`2026-08-12-production-stack.md`](2026-08-12-production-stack.md).
Those say *what to build on*. **This says what to do.**

Sizes are complexity, not time: **S** one sitting · **M** a few sittings · **L** a week of
focus · **XL** needs breaking down before anyone starts.

Nothing here is ordered by taste. The order is dependency and risk: things that unblock
others first, things that are irreversible early, things that are cheap to change late.

---

## Phase 0 — Before any migration code (do these first)

Skipping these is how a rewrite ends up worse than what it replaced.

| ID | Item | Size | Done when |
|---|---|---|---|
| **P0-1** | **Write `lib/contracts.ts` — the FE/BE types — before anything else.** Zod schemas for Project, Rubric, Criterion, Attempt, EvidenceVerdict, Question, DefenseAnswer. Both developers agree on it together. | M | Both sides import the same file. No type is defined twice. |
| **P0-2** | **Port `test/design-system.test.mjs` and `test/invariants.test.mjs` to run against the new tree.** They are grep over source; re-point the paths. | S | Both green against an empty Next.js shell. |
| **P0-3** | **Capture a golden-path fixture set** from the working vanilla build: 10 real transcripts × their rubrics × the exact analyzer output today. | M | A JSON fixture the new analyzer must reproduce byte-for-byte. |
| **P0-4** | **Measure the grounding rejection rate on the current build.** How often does the model claim support and `spanIsGrounded` discard it? Never measured. | S | A number, with the model ID and date. This is the baseline the rewrite must not regress. |
| **P0-5** | **Decide the Neon region.** Jakarta if available, else Singapore. This is a compliance decision and the privacy copy depends on it. | S | Region chosen and written into the spec. |

> **P0-3 is the one people skip.** Without it, "did the rewrite change the behaviour?" is
> answered by opinion. With it, it's answered by a diff.

---

## Phase 1 — The migration (M)

Domain logic ports; the shell is rebuilt. `analyzer.mjs` and `semantic.mjs` are pure and
dependency-free, which is the whole reason this is affordable.

| ID | Item | Size | Notes |
|---|---|---|---|
| **M-1** | Next.js 16.3 scaffold, TypeScript `strict`, Turbopack. CSS imported unchanged. | S | `design-system.test.mjs` green on the empty shell or the port is already wrong. |
| **M-2** | Drizzle schema + first migration against Neon. Tables per target arch §5. | M | Migrations checked in. `engine` column on `evidence_verdicts` — that's what keeps the mode badge honest. |
| **M-3** | Port `analyzer.mjs` → `lib/analyzer.ts`. Tests port with it. | M | P0-3 fixtures reproduce exactly. |
| **M-4** | Port `spanIsGrounded` → `lib/grounding.ts` **with the Unicode normalisation fix** (smart quotes, en/em dashes, collapsed whitespace). | S | Currently discards correct verdicts when the model returns a typographic quote. Known defect. |
| **M-5** | `lib/ai/evidence-judge.ts` — AI SDK v6, `Output.object()`, one criterion per call, parallel. | L | Gateway `models[]` for availability; app-level retry for grounding failure. Both. |
| **M-6** | `lib/ai/rubric-parser.ts` — paste a scoring matrix, get criteria. Student confirms before save. | M | Already exists as `rubric-import.mjs`; port and widen. |
| **M-7** | `lib/ai/question-generator.ts` — hardest question from the weakest criterion. | M | |
| **M-8** | `lib/ai/defense-judge.ts` — EvidenceJudge reused, scoped to one criterion. | S | Same row shape, `stage: 'defense'`. |
| **M-9** | Route handlers per target arch §3. Zod at every boundary. | M | Typed errors, never a silent 200 with a wrong answer. |
| **M-10** | Screens: home → practice (setup/attempt/review/defend) → rubric → progress. Against fixtures first, wired second. | L | Interaction flow is **frozen**. Same screens, same steps. |
| **M-11** | Better Auth + the guest path. Sign-in UI matching the frozen visual system. | L | Guest is not a fallback, it's a supported mode. |
| **M-12** | Playwright port of the demo gate and browser checks. | M | |
| **M-13** | **Cut over.** Vanilla build stays deployed and untouched until the golden path is green in both engines. | S | There is never a window with no working product. |

---

## Phase 2 — Retaining the information (D)

Nobody's existing work gets lost. This is the phase that earns trust from the people who used
it earliest.

| ID | Item | Size | Done when |
|---|---|---|---|
| **D-1** | **Import from `localStorage`.** On first load, if `talkactive.workspace.v1` exists: *"You have N projects saved in this browser. Bring them in?"* Real validated endpoint. | M | Local blob is **kept**, not deleted, until the user confirms the import worked. |
| **D-2** | **Export everything as JSON.** Projects, rubrics, criteria, attempts, verdicts, questions, answers. | S | UU PDP portability. Also the honest answer to "what if I quit?" |
| **D-3** | **Delete for real.** Hard delete via cascade, no soft-delete flag, no tombstone holding the transcript. | S | Deleting an account removes the rows. Verified by a test that counts them. |
| **D-4** | Local-only mode stays supported indefinitely. | S | An account syncs devices; it does not gate the first run. |

---

## Phase 3 — Making the AI layer genuinely good (A)

The design is settled. These are the things that make it *work well* rather than merely work.

| ID | Item | Size | Why it matters |
|---|---|---|---|
| **A-1** | **Log the grounding rejection rate per criterion, per model ID.** Already computed on every request and currently thrown away. | S | The single most useful number in the product. When it moves, something broke — and you'll know in a day, not from a user. |
| **A-2** | **Double-count check.** Per-criterion isolation means the same span can be cited for three criteria. Deterministic post-pass. | M | Direct cost of the isolation design. Cheap to fix, embarrassing if a judge spots it. |
| **A-3** | **Model bake-off on verbatim reproduction, not benchmarks.** Small tier is selected on whether it quotes exactly. | M | A model that paraphrases while quoting fails grounding every call and silently degrades to deterministic. |
| **A-4** | **Prompt-cache the transcript.** Same transcript, N criteria — cache reads are ~10% of write cost. | M | Turns per-criterion isolation from expensive into cheap. This is what makes the design affordable. |
| **A-5** | **Confirmations as an eval set.** When a student says "no, that's not sufficient", store it. Never training data — an evaluation set. | M | Free, honest, and it compounds. Regression suite from real disagreements. |
| **A-6** | **Source-document grounding for the question.** `source_documents` is in the schema. Condition the adversarial question on the student's own materials. | L | Turns a good question into one only *their* judge would ask. Strongest unbuilt differentiator. |
| **A-7** | Rate limiting on AI endpoints, per user and per IP. | S | One attempt fans out to N calls. One script spends real money fast. |

---

## Phase 4 — Frontend and UX (F)

| ID | Item | Size | Why |
|---|---|---|---|
| **F-1** | **Make the cited quote the largest thing on the review screen.** `--step-evidence` exists for exactly this. | S | It is the entire differentiator and currently reads as body text next to a percentage. |
| **F-2** | **One dominant action per screen.** Dashboard has two competing CTAs today. | M | Measured: the resume action sits below the fold at 720p. |
| **F-3** | **Attempt diff.** Side by side: what changed on this criterion between attempt N and N+1. | L | The product's promise is improvement. Right now you can't *see* improvement. |
| **F-4** | **Recurring-weakness view.** `AVG(coverage_score) GROUP BY criterion_id`, worst first. | M | Schema already supports it. "You have gone into three rehearsals without evidence for Differentiation" is the sentence that makes someone come back. |
| **F-5** | **Shareable read-only evidence report** for a supervisor or mentor. | M | Real behaviour — students already screenshot and send. Give them a link. |
| **F-6** | Pipeline progress panel — port from the vanilla build. | S | Already built and tested. Don't lose it. |
| **F-7** | Full keyboard path + screen-reader pass on the whole loop. | M | Not decoration. It's a product for students, some of whom need it. |
| **F-8** | Social preview tags, custom 404, `robots.txt`, canonical. | S | Cheap. Their absence is what "unfinished" looks like. |
| **F-9** | Rubric library: skripsi defense, beasiswa interview, PKM, hackathon pitch, job interview. | M | Biggest cold-start reducer available. A blank rubric editor is where people quit. |

---

## Phase 5 — Platform (P)

| ID | Item | Size |
|---|---|---|
| **P-1** | CI on every PR: typecheck, unit, Playwright, invariants. Green is the merge permission. | M |
| **P-2** | Domain event logging: latency per unit, fallback rate, cost per attempt, grounding rejection. | M |
| **P-3** | Error tracking with the transcript **redacted**. | S |
| **P-4** | Staging environment on a separate Neon branch. | S |
| **P-5** | Backups and a restore you have actually tested. | S |
| **P-6** | Cost dashboard per user per month. Know the unit economics before pricing anything. | M |

---

## Phase 6 — The two features asked for on 12 August

Both are designed here rather than left as one-liners, because both turned out to have a
dependency or a trade-off that is not obvious from the request.

### 6.1 Claude/GPT-style progressive reveal (S-1 … S-3)

**This is blocked on M-5, and that is the most useful thing to know about it.**

`src/semantic.mjs:355` sends **one batched call covering every criterion** and walks the model
chain sequentially. The whole payload arrives at once. There is nothing to stream, because
nothing finishes before anything else.

Revealing criteria one at a time out of a payload that already arrived complete would be
theatre — a progress animation over a finished result. That is precisely the class of thing
INV-2 exists to stop, and a judge who opens the network tab sees a single response.

So the honest sequence is:

| ID | Item | Size | Depends on |
|---|---|---|---|
| **S-1** | **M-5 first**: one call per criterion, issued in parallel. | L | — |
| **S-2** | `/api/analyze` becomes **SSE**. One event per criterion, emitted the moment that criterion's verdict clears `spanIsGrounded`. Plus a terminal event carrying delivery metrics and the weakest-criterion pick. | M | S-1 |
| **S-3** | Review screen renders the criteria list immediately from the deterministic pass, then **upgrades each row in place** as its semantic event lands. The existing two-stage panel becomes the header of that list. | M | S-2 |

Why this is *better* than a token stream, not merely a substitute: Claude streams tokens
because prose is linear. Our unit of progress is not a token — it is a **grounded verdict**,
the thing the product actually promises. Watching evidence attach to criteria one by one shows
the differentiator working. Watching tokens would show a model talking.

SSE needs no special runtime. Streaming works on the default Node runtime on Vercel Functions;
`runtime = 'edge'` is not required and should not be used.

**Interim, buildable today (S-0, size S):** the client cannot narrate vendor progress
*during* the call — `onAttempt` fires server-side inside `analyzeWithSemantics` and nothing
reaches the browser until the single response lands. What the response *does* carry is `model`
and `degradedReason`. So the finished stage can name which vendor answered, and on a fallback
say **why** ("every provider timed out" / "no quoted span could be found in your transcript")
instead of a generic line. That turns the fallback from an apology into an explanation, and it
is the whole honest improvement available before S-1.

### 6.2 Real speech-to-text (T-1 … T-4)

The target architecture chose the browser Web Speech API and gave a strong reason: it **never
hands the application an audio buffer**, so "raw audio is not persisted" is structurally
impossible to violate rather than a policy someone has to remember.

Moving to a Whisper-class model is the right call for a production product with Indonesian and
code-mixed speech — Web Speech accuracy on mixed ID/EN is the weakest link in the capture path,
and it is Chrome-dependent. **But the trade must be stated, because it is a real downgrade in
the strength of the privacy claim**, from a structural guarantee to a policy:

> Before: we cannot store your audio.
> After: we do not store your audio.

Both are true. Only the first is unfalsifiable. INV-4 says disclose the boundary, so the copy
changes with the architecture — this is not a detail to leave to whoever writes the settings
page.

| ID | Item | Size | Notes |
|---|---|---|---|
| **T-1** | `MediaRecorder` capture → `POST /api/transcribe` → Whisper-class model → timestamped transcript. **The audio buffer lives only for the duration of the request.** Never written to Blob, never written to Postgres. | L | Enforce with a test that greps the handler for any persistence call, the same way the invariants are enforced today. |
| **T-2** | **Keep Web Speech API as a selectable path**, not a fallback that only appears on failure. It is the offline path, the no-API-key path, and the choice for anyone who prefers audio never to leave the device. | M | The offline demo path stops working the day this becomes the only option. |
| **T-3** | Model choice measured on **Indonesian and code-mixed ID/EN**, not on English WER. Groq `whisper-large-v3-turbo` is the leading candidate on cost and latency; verify against real recordings of the team before committing. | M | Same discipline as A-3: select on the property we need, not the published benchmark. |
| **T-4** | Rewrite the privacy copy on the practice screen and the brief to match whichever path is active, and say which one is running. | S | INV-2 and INV-4. Non-negotiable and easy to forget. |

### 6.3 The identity affordance

The 12 August regression — a modal after kiosk reset made the whole workspace inert, including
the sidebar "+" — is fixed. The remaining work is the real thing:

| ID | Item | Size |
|---|---|---|
| **X-1** | Better Auth accounts, per M-11, with the guest path preserved as a first-class mode. | L |
| **X-2** | Project CRUD: rename, archive, delete, reorder. Today a project can only be created. | M |
| **X-3** | **Hit-test every control in the browser gate**, not just the ones a modal happens to sit over. `element.click()` fires on nodes no human can reach; `document.elementFromPoint` is what catches it. Already applied to the reset path — generalise it. | M |

> **X-3 is the lesson of the 12 August bug and worth more than the bug.** A test suite that
> drives the product in ways a user cannot will keep reporting green while the product is
> unusable.

---

## Deliberately not doing (and the condition that would change it)

Saying no is the useful half. Each of these was considered.

| Not doing | Why | Would revisit if |
|---|---|---|
| Body-language / video scoring | Different product. Unfalsifiable feedback. | Never, for this thesis. |
| Numeric "speaking ability" score | Violates INV-2. The whole point is evidence, not a number. | Never. |
| Streaks, badges, gamification | Rewards showing up, not improving. | Never. |
| Institutional dashboards | INV-6 held this out until the core loop is validated. | Core loop validated with real cohorts **and** a university asks. Not before. |
| Vector DB / retrieval over transcripts | ~900 words fits in context. Chunking **breaks** verbatim span reproduction — the property everything rests on. | Transcripts get long enough that context is the binding constraint. |
| An agent framework | Fixed steps, known order, no tool selection. It's a workflow, not an agent. | Never, unless the pipeline becomes genuinely dynamic. |
| A second LLM verifying the first | Argued at length in AI layer §9.6. Grounding + the student is stronger and cheaper. | An NLI entailment model beats `spanIsGrounded` on a measured eval set. |
| Client-side analytics | Third-party origin on a page whose privacy claim is that work stays local. | Never. Server-side domain events are better data anyway. |

---

## If you only do six things

Ranked by value per unit of effort, ignoring the migration itself:

1. **P0-3** golden-path fixtures — without it you cannot tell if the rewrite broke anything
2. **A-1** grounding rejection rate — one number, tells you whether the AI layer works
3. **F-4** recurring-weakness view — the schema already supports it; it's the retention feature
4. **D-1** import from localStorage — do not punish your earliest users
5. **A-4** prompt caching — makes the per-criterion design cheap instead of expensive
6. **F-9** rubric library — a blank editor is where people quit

**A-6** (source-document grounding) is the highest-ceiling item on this page and the one that
would be hardest for anyone to copy. It is also **L** and depends on the migration landing
first, which is why it isn't in the six.
