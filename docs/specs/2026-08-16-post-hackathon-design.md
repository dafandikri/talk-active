# Post-hackathon design — 16 August 2026

> Supersedes [`2026-08-10-innovation-week.md`](./2026-08-10-innovation-week.md) as the active
> plan. That file stays as the record of the finals sprint; nothing in it is still scheduled.

The finals are over. This spec covers what Talk-Active needs in order to be a maintained
product rather than a demo that survived four days: the features that were scoped but never
finished, the language gap that makes the product read as English-first to an Indonesian
student, and the harness rot that a four-day sprint leaves behind.

**Baseline at the time of writing:** `node --test` passes 438 of 438. Nothing here is rescue
work; every change is additive to a green tree.

---

## Findings that shaped the plan

### 1. The visible English is in TypeScript, not in the prompts

The AI layer was built so the model *selects a quote* and application code *writes the
sentence the user reads*. `question-generator.ts` says so in its own system prompt:
"Application code, not you, writes the visible question."

That design is what makes INV-3 hold. It also means the visible question is an English
template literal on every path:

- `composeQuestion` — `apps/web/lib/ai/question-generator.ts:175`
- `makeJudgeQuestion` — `apps/web/lib/analyzer.ts:308`
- `makeDrill` — `apps/web/lib/analyzer.ts:320`

So Kato asks his opening question in Indonesian (`interview-session.ts:67`), the student
answers in Indonesian, and the follow-up question comes back in English. Semantic mode and
deterministic mode are equally affected, because both call the same templates.

The consequence for this plan is that the primary fix is deterministic i18n in code. It adds
no new model failure mode and no new way for the demo to break. Only two fields are genuinely
model-authored English:

| Field | Unit | Today |
|---|---|---|
| `missingEvidence` | `evidence-judge.ts` | Model-authored, no language directive |
| `blanks` | `claim-coach.ts` | Model-authored; prompt covers `strongerForm` only |
| `citedSpan` | both | Verbatim transcript span — already correct, must not change |

### 2. Sentence splitting is why issue #32 exists, and dictation is its worst case

```ts
// apps/web/lib/analyzer.ts:211
function splitSentences(transcript: string): string[] {
  const sentences = transcript
    .split(/(?<=[.!?])\s+|\r?\n+/u)
```

A transcript containing no `.`, `!` or `?` collapses to a single element. `evidenceForCriterion`
then ranks that one element for every criterion and returns it as `excerpt` each time, so the
whole transcript becomes the cited blockquote for all of them.

Browser dictation does not reliably emit terminal punctuation, and the `id-ID` path is where
this is most visible because dictation is the primary Indonesian capture route. This is the
same defect reported in issue **#32** ("the deterministic analyzer cites the same sentence for
several criteria"); the seeded starter draft merely shows a milder form of it.

The team's earlier response was to *disclose* reuse (`lib/citation-reuse.ts`, plus the note at
`practice-room.tsx:1671`). That disclosure is correct and stays. It is not a fix.

### 3. Interview coaching is gated off by one condition

```ts
// apps/web/components/practice-room.tsx:1220
if (!analysis || rehearsalFormat !== 'presentation' || !semanticCoachAvailable) return;
```

The same condition gates the UI at `practice-room.tsx:1677`. The coaching engine
(`lib/ai/claim-coach.ts`) is complete and defensible — verbatim-span grounding, a
`fabricatedNumbers()` guard that voids any draft inventing a digit, a two-attempt correction
loop, and an honest `503` when no model is configured. Interview mode simply never calls it.

### 4. Two language concepts exist; only one is built

- **`ProjectLanguage`** (`lib/contracts.ts:15`, `db/schema.ts:75`) — drives Kato's questions,
  TTS narration, and dictation locale. Works.
- **App chrome language** — does not exist. `app/layout.tsx:38` is a hardcoded
  `<html lang="en">`, and every user-facing string is an inline JSX literal.

These are genuinely separate choices. A student rehearsing an English-language pitch may still
want an Indonesian interface.

### 5. The harness certifies a command that does not exist

`.github/PULL_REQUEST_TEMPLATE.md` ends with:

> - [ ] If this touches the demo path, `pnpm demo` is green

`pnpm demo` is not a script in `package.json`. It went out with the vanilla build on 12 August.
`test/harness-integration.test.mjs:88` asserts the template still contains that line:

```js
assert.match(template, /pnpm demo.*green/iu);
```

AGENTS.md already records catching this exact mistake once, for INV-8, and corrected the
invariant to name `e2e/production-ui/` instead. The PR template and its guarding test were
never updated. So every contributor is asked to certify a green run of an unrunnable command,
and a passing test enforces the request.

---

## Decisions

Taken 16 August 2026.

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| D1 | App translation | `next-intl`, cookie-based, no `[locale]` URL segment | Hand-rolled dictionary; reusing `ProjectLanguage` for chrome |
| D2 | Interview coaching | Reuse `/api/coach`, one call per turn | Folding into `/api/interview/analyze`; a new dedicated route |
| D3 | Issue tracker | Close all 14 open issues, refile clean | Selective close; leaving the tracker alone |
| D4 | AGENTS.md | Full rewrite for a maintained project | Retarget in place; minimal edits |

**D1 rationale.** A `[locale]` segment would rewrite every route string in the app and all 13
specs in `e2e/production-ui/`. Cookie-based resolution keeps `/practice`, `/rubric`,
`/progress` and every test path byte-identical. Default locale is `id` — the product is for
Indonesian students, and English is the exception rather than the base case.

**D2 rationale.** `aggregateInterviewAnswers` exists but carries a documented hazard: its
comment at `interview-session.ts:167` warns that a rubric cue inside Kato's question must never
become evidence supposedly supplied by the student. Coaching each answer against its own
criterion keeps that guarantee structural rather than prompt-enforced. It also preserves the
degradation shape the presentation path already has — one criterion's coaching failure degrades
alone instead of taking the review with it.

**D4 rationale and its one carve-out.** The sprint scaffolding is dead: the 13 August freeze,
the mentoring-session quorum, the per-person scoring-block ownership table. Those go.
**INV-1 through INV-8 stay**, in full, with their reasoning. They are live law enforced by
`test/invariants.test.mjs` and `e2e/production-ui/`, and the reasoning is the part that makes a
tired contributor obey them at 2am. An invariant presented without its argument reads as
arbitrary, and arbitrary rules are the ones people weaken to go green.

---

## Workstreams

Ordered so that each ships green on its own. B and A are first because they are the smallest
diffs and the most visible; B also retires an open issue.

**These four are deliberately separate.** They touch disjoint parts of the tree, and none
depends on another landing first — B and A are in the analysis layer, D is docs and harness, C
is the component layer. Each gets its own commits and its own green `pnpm check`. C is large
enough that it is decomposed further into seven per-surface steps below rather than treated as
one unit.

### B · Indonesian-first output

**Goal.** An Indonesian project produces Indonesian output on every surface, in both semantic
and deterministic mode.

| Unit | Change |
|---|---|
| `question-generator.ts:175` `composeQuestion` | Accept the criterion's project language; template both locales |
| `analyzer.ts:308` `makeJudgeQuestion` | Same |
| `analyzer.ts:320` `makeDrill` | Same, including the "claim → evidence → why it matters" structure |
| `analyzer.ts:211` `splitSentences` | Add a fallback segmentation when no terminal punctuation exists |
| `evidence-judge.ts` system prompt | Add an output-language directive scoped to `missingEvidence` |
| `claim-coach.ts:39` | Extend the existing language line to cover `blanks` |
| `rehearsal/filler-cues.ts`, `rehearsal/wording-cues.ts` | Localise display labels (detection already covers Indonesian) |

**`splitSentences` fallback.** Precise rule, so the implementation has nothing left to guess:

1. Split on terminal punctuation as today. If that yields more than one segment, return it
   unchanged — punctuated transcripts keep their current behaviour exactly.
2. Otherwise, if the single segment is at most 240 characters, return it unchanged. A short
   unpunctuated answer is one utterance and splitting it would invent boundaries.
3. Otherwise, split on Indonesian and English clause connectives at a word boundary
   (`dan`, `lalu`, `kemudian`, `sedangkan`, `sehingga`, `karena`, `jadi`, `then`, `so`,
   `because`, `and then`), keeping the connective with the segment that follows it.
4. Merge any resulting segment under 40 characters into its predecessor, so a stray connective
   cannot produce a two-word "sentence" that would then be cited as evidence.

Hard constraint on every branch: each returned segment must be a **verbatim contiguous
substring** of the input. `excerpt` feeds a blockquote that INV-3 requires to be the speaker's
actual words, and `findGroundedSpan` will reject anything else. No repunctuation, no
normalisation, no synthesis. The test asserts the substring property directly, not just the
segment count.

**`citedSpan` must not change.** It is a verbatim transcript span, so it is already in the
speaker's language, and `findGroundedSpan` will reject it if anything alters it.

**Done when.** An Indonesian rehearsal produces an Indonesian judge question, Indonesian drill
text, and Indonesian `missingEvidence`; a dictated transcript with no terminal punctuation
yields distinct spans across criteria; `test/analyzer.test.mjs` covers the unpunctuated case
and `test/project-language.test.mjs` covers the output language; `pnpm check` green.

**Closes.** #32.

### A · Per-criterion AI answers in interview Q&A

**Goal.** After an interview, each criterion shows what the student asserted for it, which
assertions their own words backed, and a stronger form built only from what they already said —
the same treatment the presentation path already gives.

1. Remove the `rehearsalFormat !== 'presentation'` condition at `practice-room.tsx:1220` and
   `:1677`.
2. Call `coachCriterion(turn.answer, turn.criterion)` per turn, fanned out the way
   `coachCriteria` already does (first call alone to warm the prompt cache, remainder in
   parallel).
3. Add a rate-limit cost function for an N-turn interview, mirroring `coachRateLimitCost`.
4. Render the coaching in the interview review, reusing the presentation path's card.

**Unchanged and reused:** `findGroundedSpan`, `fabricatedNumbers`, the two-attempt correction
loop, and the `503 coach_unavailable` problem response. No new prompt.

**Done when.** A completed interview shows per-criterion coaching for every turn; one turn's
coaching failure leaves the others and the verdicts intact; `e2e/production-ui/interview.spec.ts`
covers the coached review; `pnpm check` green.

### D · Harness, docs, and dead code

1. **Rewrite `AGENTS.md`** for a maintained project. Keep INV-1..INV-8 with their reasoning and
   their enforcement mapping. Drop the freeze date, the attendance quorum, the scoring-block
   ownership table, and the day-by-day schedule. Keep the `docs/AGENT-WORKFLOW.md` pointer
   (`test/agent-workflow.test.mjs:32` asserts it) and the guardrail against naming an AI tool as
   a commit author.
2. **Fix `.github/PULL_REQUEST_TEMPLATE.md`** — replace the `pnpm demo` line with
   `pnpm test:production:browser`, and update `test/harness-integration.test.mjs:88` to assert
   the command that exists. This is a case where changing the test is correct: the test is
   enforcing a false statement.
3. **Fold `HANDOVER.md` into the docs that outlive it** and archive it. Its live facts are the
   production URL, the migration prerequisite, and the contributor flow.
4. ~~**Delete the vanilla-build leftovers**~~ — **withdrawn, 16 August.** This was wrong.
   `src/tokens.css`, `src/styles.css` and `src/landing.css` are not leftovers: `apps/web/app/layout.tsx`
   imports all three, in that order, and `test/design-system.test.mjs` asserts the order. They are
   the live stylesheets, which is also why the harness lists `src/styles.css` as a required
   artifact. The root `public/*.html` files are untracked build output — `.gitignore` excludes
   `/public/`, and `git ls-files public` returns nothing — so there is nothing to delete there
   either. The directory looks like sprint residue and is not.
5. **Re-verify every command named in the docs actually runs.** The `pnpm demo` incident is the
   second occurrence of a doc naming a dead command; a check that enumerates commands mentioned
   in Markdown and asserts each exists in `package.json` would make it the last.

**Done when.** Every command named in `AGENTS.md`, `README.md`, and the PR template resolves to
a real script; no doc references a deleted file; `pnpm check` green.

### C · App-language translation

**Goal.** A user can switch the interface between Bahasa Indonesia and English, independently of
the language they rehearse in.

1. `next-intl` plugin in `apps/web/next.config.ts`; `i18n/request.ts` resolving a `locale`
   cookie with `id` as the fallback.
2. `NextIntlClientProvider` in `app/layout.tsx`; `<html lang>` becomes dynamic.
3. `messages/id.json` and `messages/en.json`.
4. A switcher in the account panel, writing the cookie and calling `router.refresh()`. It sits
   apart from the per-project language picker at `practice-room.tsx:1472`, and the two are
   labelled so the difference is legible.
5. Extract strings **per surface**, one shippable commit each, in ascending order of size:

   | Order | Surface | Lines |
   |---|---|---|
   | 1 | `entry-gate`, `production-shell`, `toast`, marketing, auth | ~310 |
   | 2 | `account-panel`, `workspace-frame` | ~380 |
   | 3 | `progress-view`, `progress-charts`, `delivery-charts` | ~700 |
   | 4 | `rubric-editor`, `saved-attempt-review` | ~895 |
   | 5 | `interview-session`, `multimodal-review` | ~800 |
   | 6 | `workspace/page`, `multimodal-studio` | ~1450 |
   | 7 | `practice-room` | ~1800 |

**Targeted improvement, taken during step 7 and not before.** `practice-room.tsx` is 1804 lines
and holds presentation practice, the interview flow, defence, coaching, and project-language
state. Extracting its strings means reading all of it, which is the right moment to split it
along those seams. This is scoped to the file being worked in; no unrelated refactoring.

**Done when.** Every user-facing string resolves through the catalogue; both locales render
every screen with no missing-key fallback; route paths and all 13 `e2e/production-ui/` specs are
unchanged; `pnpm check` green.

### E · Issue tracker

Close all 14 open issues and refile. Before closing **#32**, copy its analysis into its
replacement — it contains real reasoning, its stated definition of done is genuinely unmet, and
workstream B supersedes it.

Issues closed as event-passed: #8, #15, #16, #17, #18, #19, #20, #21, #23, #24.
Closed as already-done, with the evidence cited in the closing comment: #10 (targets
`src/app.mjs`, deleted with the vanilla build), #31 (production is `talk-active-id.vercel.app`).
Closed and superseded: #30 (carried forward — it needs an account top-up, not code), #32.

New issues: one per workstream A–D, plus the AI Gateway credit top-up.

---

## Out of scope

Unchanged from AGENTS.md INV-6, and restated because a maintenance phase is exactly when scope
creeps back: body-language scoring, streaks, generic speaking drills, institutional dashboards,
and any figure presented as a measure of the speaker.

Also out of scope for this spec specifically: additional locales beyond `id` and `en`, a
server-side transcription provider to replace browser dictation, and any change to the
persistence model.

The transcription question deserves a note. Workstream B fixes what the *analyzer* does with an
unpunctuated Indonesian transcript, which is the part inside our control. It does not improve
the browser's Indonesian recognition accuracy — that is the vendor's model. If accuracy is still
the binding constraint after B ships, replacing the capture path with a server-side provider is
a separate spec with its own cost, latency, and privacy argument, and it would need a new
consent surface under the existing per-signal consent rule.

---

## Risks

| Risk | Mitigation |
|---|---|
| The `splitSentences` fallback produces spans that are not verbatim substrings, breaking INV-3 | Assert the substring property in the test, not just the split count |
| A missing message key renders a raw key to a user | `next-intl` fails loudly on missing keys in development; treat a missing key as a build failure, consistent with INV-7 |
| The i18n extraction silently changes copy under the guise of translation | Extract first, translate second, in separate commits, so the diff of each is reviewable |
| Rewriting AGENTS.md loses an invariant's reasoning | INV-1..INV-8 and their rationale are carried forward verbatim in intent; `test/invariants.test.mjs` stays untouched |
| Coaching N interview turns multiplies AI spend | Reuse the existing rate limiter with a per-turn cost; the transcript-hash cache already covers repeats |
