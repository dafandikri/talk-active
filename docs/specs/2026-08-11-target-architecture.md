# Talk-Active — Target Architecture

**Date:** 2026-08-11 · **Status:** active · **Supersedes:** nothing
**Relationship to [`2026-08-10-innovation-week.md`](2026-08-10-innovation-week.md):** that spec governs
what ships at the finals. This one governs what the product is built on. They are not in
conflict — the sprint spec is a schedule, this is a destination.

---

## 1. Why this document exists

Three documents describe Talk-Active's architecture and no two of them agree.

| Source | Says the stack is |
|---|---|
| `docs/proposal/body.tex:256-275` (submitted) | Next.js, React, TypeScript, Tailwind, Postgres/Neon, Clerk, Vercel Blob, Upstash Redis, AI Gateway + AI SDK |
| The working build | Vanilla JS ES modules, `localStorage`, one Vercel Function, zero runtime dependencies |
| `docs/MENTORING/2026-08-11-talk-active-app-layer-design.md` | The proposal's stack, built from scratch |

This document resolves that. **The proposal's stack is the target.** The prototype was
scaffolding that outlived its brief, and it is time to say so in a commit rather than let
three descriptions of the same product circulate.

### A correction that shaped this decision

The mentoring design doc states at line 6 that it starts from "a blank repo — no existing
prototype code to build on", and at line 301 that "no git repository exists yet in this
working directory". Both are false. It was generated in an empty folder and never saw this
repository, which has 130 passing tests and a live deployment.

That error is worth recording, because the natural reaction — dismiss the document — would
be the wrong one. Its *destination* is right: it independently reconstructed the stack the
proposal already committed to. Its data model, its asymmetric-failure argument for scoping a
verifier, and its failure-handling table are all sound and are drawn on below. Only its
premise about starting conditions was wrong.

### The claim/reality gap this closes

`body.tex` Table 3 lists Postgres and Clerk. Table 4, two pages later, marks "Projects &
persistence" as **Built** — and it is, via browser `localStorage`. Both statements are
individually defensible and together they read as a capability claim the build does not
have. INV-2 exists for exactly this. Migrating closes the gap by making the stack table
true; the alternative is amending the stack table, which was considered and rejected.

---

## 2. What is frozen and what is open

Decided with the lead on 2026-08-11.

| | Status | Consequence |
|---|---|---|
| **Visual design** | **Frozen** | The new build must be visually indistinguishable. `src/tokens.css`, `src/styles.css`, `src/landing.css` port as-is. No Tailwind rewrite. |
| **Interaction flow** | **Frozen** | `home → practice (setup/attempt/review/defend) → rubric → progress`. Same screens, same sequence, same steps. |
| Domain logic | Open | The analyzer and semantic layer may be redesigned. §4 does exactly that. |
| Persistence | Open | `localStorage` → Postgres. |
| Copy | Open | May be revised, subject to the INV-2/INV-4 obligations it carries. |

**Tailwind is dropped from the stack.** The proposal names it, but the design system is
already a working set of CSS custom properties with a test enforcing it
(`test/design-system.test.mjs`) and 87k of deliberate CSS behind commits like *"Build the
design system around the citation, not around a palette"*. Rewriting that into utility
classes is precisely the "reinterpret the design" risk the freeze exists to prevent. Next.js
imports plain CSS with no ceremony, and custom properties feed a Tailwind theme later if
that is ever wanted. This is a documented deviation from `body.tex:256`, not an oversight.

**`test/design-system.test.mjs` must keep passing against the new build.** It is the
mechanism that *proves* the visual port is faithful instead of relying on eyeballing.

---

## 3. Architecture

Single Next.js (App Router) project on Vercel. No separate backend service.

```
app/
  (marketing)/                    landing — port of landing.css
  (app)/
    page.tsx                      home
    practice/                     setup → attempt → review → defend
    rubric/                       rubric editor + import
    progress/                     coverage trend
  api/
    rubrics/parse                 RubricParser
    projects/[id]/rubric          persist confirmed criteria (no AI)
    attempts                      create attempt (no AI)
    attempts/[id]/evidence        EvidenceJudge ×N ∥, then Verifier
    attempts/[id]/question        QuestionGenerator
    attempts/[id]/defense         EvidenceJudge ×1, scoped
    progress/[projectId]          SQL aggregation, zero model calls
lib/
  contracts.ts                    Zod schemas + inferred TS types — the FE/BE contract
  ai/                             the four units, each independently testable
  grounding.ts                    verbatim-span check, ported
  analyzer.ts                     deterministic fallback, ported
  db/                             Drizzle schema + queries
styles/                           tokens.css, styles.css, landing.css — imported as-is
```

- **Compute:** every `api/*` route is a Vercel Function on Fluid Compute, Node.js runtime.
  Not Edge — full Node APIs are needed and Edge buys nothing here.
- **Client:** Server Components for read views (home, progress). Client Components for the
  recorder, the rubric editor, and the evidence review.
- **Auth:** Clerk middleware gates `(app)`. No local `users` table; the Clerk user ID is
  stored directly as `user_id` on `projects`.
- **Not durable workflows.** Plain route handlers. The pipeline is five short steps with no
  human-in-the-loop pause and no multi-minute execution; WDK's durability would be paying
  for a guarantee this shape does not need.

---

## 4. The AI layer

> **Full component-level specification: [`2026-08-11-ai-layer.md`](2026-08-11-ai-layer.md)** —
> every schema, prompt rule, failure path, cost model, and the evidence base behind each
> decision. This section is the summary; that document is authoritative where they differ.

### 4.1 What exists today, stated precisely

`src/semantic.mjs` sends the whole transcript with **all criteria in one batched call**,
overlays the returned verdicts onto a deterministic result, and requires every cited span to
be a literal substring of the transcript (`:165-169`), discarding supporting verdicts that
fail (`:192-193`). If nothing grounds at all, the whole model pass is rejected and the next
vendor is tried (`:216-219`).

**That substring check is already a verifier, and for the failure it targets it is strictly
better than an LLM one** — it cannot hallucinate, costs nothing, and adds no latency. Any
discussion of "adding a verification layer" has to start from this fact rather than assume
the field is empty.

### 4.2 Three defects carried by the current implementation

These are recorded here because they inform the redesign, and because two of them are
honesty problems rather than engineering ones.

1. **Partial fabrication survives.** `:217` rejects a model pass only when *zero* spans
   ground. A response where three of five quotes are real passes intact.
2. **The mode badge can overstate.** Nothing requires a verdict per criterion (`:184-186`),
   so a response can be badged `mode: 'semantic'` while individual criteria were in fact
   answered deterministically. Nothing on screen distinguishes them. **This is an INV-4
   boundary that is currently hidden, and an INV-2 claim the build does not fully have.**
3. **Legitimate results are discarded.** The client aborts at 15s (`src/app.mjs:603`) while
   the server chain budget is 22s (`src/semantic.mjs:86`); anything not `mode === 'semantic'`
   is thrown away (`:613`). A chain that succeeds at 16–22s shows the user deterministic mode.

Defects 1 and 2 are **solved structurally** by the design in §4.3 rather than by adding
checks. Defect 3 is a live bug in the shipping build and is tracked as **P0** in the backlog.

### 4.3 Target design: four units, per-criterion, parallel

| Unit | Job | Input → Output | Tier |
|---|---|---|---|
| **RubricParser** | Structure raw rubric text into criteria | text → `Criterion[]` | Stronger — runs once per project, quality compounds |
| **EvidenceJudge** | Judge one criterion against the transcript | transcript + 1 criterion → `{verdict, span, missing[]}` | Small/fast — runs per criterion, in parallel |
| **QuestionGenerator** | Write the one adversarial question | weakest criterion + missing evidence + transcript → `{question, challengedClaim}` | Stronger — the differentiator |

**There is no LLM verifier.** Verification is deterministic grounding plus the student. §4.3.4
gives the reasoning and the conditions that would reverse it.

**EvidenceJudge is reused twice** — for defense evaluation (scoped to the criterion the
question targeted, judging the answer, *not* the transcript), and for the single re-judge
triggered by a student rejection (§4.3.3).

**Progress has no AI unit.** Recurring-gap tracking is a SQL aggregation over stored
verdicts. Zero model calls, and consistent with the no-invented-scores stance.

#### 4.3.1 Isolation: one criterion per call, never batched

Every call sees the minimum context its job requires, and no call ever sees a criterion it
is not judging.

- **Position bias is the documented failure mode of batched judging.** Recent evaluation
  work finds severe position bias coexisting with high test-retest reliability — a judge can
  be perfectly self-consistent and still systematically wrong depending on where an item sits
  in a list. Batching N criteria into one call buys that bias for nothing.
- **Failure stops being all-or-nothing.** `Promise.allSettled`; one criterion failing leaves
  the other verdicts standing and shows an inline retry.
- **Per-criterion provenance becomes free.** Which criteria were semantically judged is a
  property of the results array — defect 2 (§4.2) disappears without a feature being added
  to fix it.

**Corollary: no cross-criterion reasoning.** Isolation means the model cannot notice that a
span fits criterion B better than criterion A, so **the same span may be cited for several
criteria** and inflate apparent coverage. Mitigated deterministically: a post-pass flags any
span cited more than once, and the review screen shows it. This is the real cost of
isolation and it is paid in code, not in context.

#### 4.3.2 Context budget per unit

| Unit | Sees | Never sees |
|---|---|---|
| RubricParser | raw rubric text | any transcript |
| EvidenceJudge | transcript (cached) + **1** criterion | other criteria, any prior verdict |
| Re-judge on rejection | transcript + 1 criterion + the rejected span | other criteria |
| QuestionGenerator | weakest criterion + its missing evidence + transcript | verdicts for other criteria |
| Defense judge | the student's answer + 1 criterion | **the original transcript** |

**No prior model output is ever fed into a judging call.** Verdicts are compared in code.

#### 4.3.3 Prompt caching makes isolation affordable

Per-criterion isolation re-sends the transcript N times. That is the honest cost of the
design, and it is what makes batching keep looking attractive. Prompt caching removes it.

```
┌─ cached prefix ─────────────┐   identical across all N calls
│  system instructions        │
│  the transcript             │   ~1,200 tokens
└─────────────────────────────┘
┌─ varying suffix ────────────┐
│  this one criterion         │   ~40 tokens
└─────────────────────────────┘
```

Anthropic-class pricing: cache **writes** cost 1.25× base input, cache **reads** cost 0.10×
— a 90% discount — on a 5-minute default TTL. The write premium is repaid after a single
hit, and all N calls fire within seconds.

**Practical note:** fully parallel calls can all miss the cache, since none has written it
yet. Fire the first call, await it, then fan out the remaining N−1. One extra round trip
converts the rest into cache hits.

This is the resolution of the batching-versus-isolation tension: **batching existed to avoid
re-sending the transcript; caching avoids re-sending it without giving up isolation.**

#### 4.3.4 Verification: deterministic, then the student

Two layers, neither of them a model:

1. **`spanIsGrounded`** — a cited span must appear verbatim in the transcript or the verdict
   is discarded in code. This makes fabrication impossible. A string comparison beats an LLM
   at this, because it has access to ground truth outside the model's own reasoning.
2. **The student confirms.** The review screen asks: *"We read this as covering X: '⟨span⟩'.
   Did you mean it that way?"* One click. Zero cost, zero latency, and the student is the
   world expert on their own pitch.

**Why no LLM verifier.** The student reviews all 4–6 verdicts — that screen *is* the
product. A model verifier would be checking work a human checks ten seconds later, at the
cost of latency, spend, and a new failure surface. Verification belongs where nobody looks,
and here someone always looks.

The evaluation literature also warns against the obvious cheap substitute: running the same
model twice and treating agreement as confidence. High test-retest reliability coexists with
severe bias, so self-consistency measures determinism, not correctness. And the standing
recommendation is never to use the same model family as generator and judge — which rules
out precisely the self-review shape a verifier would take here.

**On a rejection**, exactly one re-judge fires, for that criterion only, with the rejected
span passed as a hard negative:

> Criterion: *X*. The student confirms this span does **not** support it: `"⟨span⟩"`. Find
> different supporting evidence in the transcript, or return `unsupported`.

**Retry only when there is new information.** A blind retry is a resample; this one has a
strictly smaller search space than the original call. It is the only retry in the pipeline
that is not just hoping for a better roll.

**Student confirmations are not training data.** They are an evaluation set. Fine-tuning at
this scale would need thousands of labels to beat a good prompt, and training on student
transcripts would put unpublished academic work into weights that cannot be unlearned —
making the UU PDP hard-deletion commitment unfulfillable in principle. The labels instead
answer the question no amount of architecture argument can: *how often is the judge actually
wrong, and in which direction?*

**Conditions that would reverse this and justify a model verifier:**

- A rubric large enough that reviewing every verdict is a burden (~20 criteria), where
  flagging becomes *triage* rather than verification.
- Unsupervised runs — the Campus tier, where a lecturer sees aggregates and nobody inspects
  individual verdicts.
- Collected labels showing a quote-mining rate high enough to matter.

The schema keeps `verifier_agreed` and `verifier_note` so adding one later is additive.

**Better candidate than an LLM when that day comes:** a natural-language-inference entailment
model (DeBERTa or multilingual XLM-RoBERTa class). Span-supports-criterion *is* an entailment
task, NLI models are purpose-built for it, and they run at a fraction of the cost and latency
of a generative call. It trades a hosted-model dependency for reliability, which is the right
trade once the product runs unsupervised — and the wrong one while it doesn't.

#### 4.3.5 Why retrieval is deliberately not built

`body.tex:232-236` specifies that "retrieval selects candidate spans" per criterion. **This
design does not implement that, on purpose.**

A rehearsal transcript is a few minutes of speech — roughly 500–900 words — which fits in
context whole many times over. Retrieval would add a tuning surface and a new silent-failure
mode (the correct span never reaching the judge) for no accuracy gain at this length. It
earns its place at 20-minute transcripts, not 4-minute ones.

**Action required:** amend the proposal sentence to describe what is built. Building an
unnecessary component in order to make a sentence true is INV-2 reasoning pointed backwards.

#### 4.3.6 Why this is a workflow, not agents

The useful distinction is Anthropic's: **workflows** orchestrate models through predefined
code paths; **agents** let the model direct its own process. Classification and extraction
with fixed inputs and schema-constrained outputs is a workflow. Current guidance is explicit
that document-classification-shaped problems are pipelines, not agents, and that the most
successful implementations use simple composable patterns rather than frameworks —
increasing complexity only when a simpler solution has demonstrably failed.

Nothing here needs a loop: no tools, no external state, no open-ended goal, no step whose
next action depends on a model's choice. The three units are ordinary function calls behind
a `Promise.allSettled`.

**Say "pipeline", not "agent", in the pitch.** Calling these agents invites *"what does your
agent do when it's uncertain — does it go look something up?"* and the honest answer is "no,
it returns a verdict and application code checks it." A three-stage pipeline with a grounding
check on every stage is both accurate and the more impressive claim, because the checking is
the unusual part. INV-2 governs architecture vocabulary too.

#### 4.3.7 Cost

Five criteria, ~900-word transcript, small/fast model, per session:

| | Uncached | Cached |
|---|---:|---:|
| EvidenceJudge ×5 | ~6,200 in | ~1,700 effective |
| QuestionGenerator | ~1,300 in | ~1,300 |
| Defense judge | ~400 in | ~400 |
| **Total** | **~$0.012** | **~$0.006** |

Roughly **Rp 100 per session** against the proposal's Rp 1,500 (`body.tex:404-408`) — the
margin argument strengthens. No verifier calls appear, because the student is the verifier.

**Seven model calls per session:** 5 judge + 1 question + 1 defense.

### 4.4 Provider strategy

**Keep the hand-rolled failover chain even after adopting the AI SDK.**

AI Gateway fails over on provider *unavailability*. It will not retry an HTTP 200 containing
a fabricated quote — and "well-formed response, invented citation" is the single most
valuable failover trigger this product has. Grounding-failure-triggered retry is application
logic and stays application logic. The SDK replaces the transport, not the judgment.

Availability comes from **provider diversity, not model diversity**: three models from one
vendor share one outage.

### 4.5 Grounding: the one fix that matters most

`spanIsGrounded` does no whitespace or punctuation normalisation (`src/semantic.mjs:167-168`).
A model quoting across a line break, or normalising curly quotes and dashes, produces a
**false negative that silently discards a correct verdict**. Normalise whitespace and common
punctuation variants before comparison, then map back to the original offsets for display.

This is the highest value-per-line change in the AI layer and it ports forward regardless of
anything else in this document.

---

## 5. Data model (Postgres via Drizzle)

Adapted from the mentoring design doc §6, which got this right.

```
projects            id, user_id (clerk), title, event_context, deadline, timestamps
rubrics             id, project_id, source_type, confirmed_at, created_at        -- 1:1 project
criteria            id, rubric_id, name, description, required_evidence, display_order
attempts            id, project_id, mode, status, transcript, transcript_source,
                    created_at, completed_at
evidence_verdicts   id, attempt_id, criterion_id, stage (initial|defense),
                    verdict (supported|partial|unsupported), coverage_score (0|0.5|1),
                    cited_span, engine (semantic|deterministic),   -- per-criterion provenance
                    verifier_agreed (null when not run), verifier_note,
                    student_overridden, student_override_verdict, created_at
questions           id, attempt_id, target_criterion_id, question_text, created_at
defense_answers     id, question_id, answer_text, created_at
source_documents    id, project_id, blob_url, filename, uploaded_at
```

Four decisions worth carrying:

1. **`engine` per verdict.** This is what makes the mode badge honest. The UI reports which
   criteria were semantically judged rather than asserting a single mode for the whole
   analysis. Defect 2 dies here.
2. **`coverage_score` alongside `verdict`.** Progress becomes
   `AVG(coverage_score) GROUP BY criterion_id`, and "most recurring gap" is `MIN(avg)`. No
   app-side mapping.
3. **`stage: initial|defense` on one table.** Defense evaluation reuses EvidenceJudge, so it
   reuses the row shape rather than a parallel table.
4. **Hard delete via cascade.** UU PDP No. 27/2022 commitment. No soft-delete flags.

**Raw audio appears nowhere in this schema, by construction.**

---

## 6. Speech-to-text

**Keep the browser Web Speech API. Do not adopt Groq Whisper for the finals.**

The decisive argument is not accuracy — it is that the Web Speech API **never hands the
application an audio buffer**. "Raw audio is not persisted" becomes architecturally
impossible to violate rather than a discipline defended in Q&A. A judge asking "where does
the audio go?" gets an answer about the design, not about a policy.

Server-side ASR is also explicitly out of scope in the active sprint spec
(`2026-08-10-innovation-week.md:76-77`), and neither option works offline, so dictation
stays off the offline demo path either way.

**Dictation is a booth flourish, not the pitch critical path.** This matches the mentor's own
ranking of live voice-to-text as the high-risk demo option.

Revisit Groq post-hackathon if ID/code-mixed accuracy proves limiting in the pilot.

---

## 7. The FE/BE contract

`lib/contracts.ts` holds Zod schemas for every API request and response, with TypeScript
types inferred from them.

**Both developers define this file together, first, before either starts implementing.** It
is the deliverable that makes parallel work real rather than aspirational: one declaration
that is simultaneously the TS type, the server's runtime validator, and the source of client
fixtures — three things that cannot drift because they are the same thing.

The frontend builds against fixtures derived from those schemas and is never blocked on an
endpoint existing.

---

## 8. Error handling

| Failure | Handling |
|---|---|
| Schema validation fails on a model response | Retry once with a stricter prompt. Second failure → that criterion falls back to deterministic and is labelled as such. |
| Cited span not found in transcript | Same retry-once. Second failure → verdict forced to `unsupported`, flagged, never fabricated as supported. |
| One criterion's call fails, others succeed | `Promise.allSettled`. Failed criterion shows inline retry; the map still renders. |
| Verifier fails or times out | Result is exactly what it would have been without the Verifier. Never blocks. |
| All providers down | Deterministic analyzer answers, mode badge says so plainly. INV-8. |
| Cost / abuse | Upstash Redis token bucket per user per AI route. Over limit → 429 with a plain message, not a silent hang. |

---

## 9. Testing

- **Unit:** grounding/normalisation, coverage aggregation, verdict-downgrade logic. Pure,
  fixture-driven, no live model calls. The existing 130 tests port with the logic they cover.
- **Integration:** each route handler against a test DB with mocked model responses; assert
  persistence and `attempts.status` transitions.
- **Visual fidelity:** `test/design-system.test.mjs` runs against the new build. This is the
  proof the §2 freeze held.
- **Golden path:** one full loop — rubric confirm → attempt → evidence → question → defense
  → progress.

---

## 10. Migration sequence

Domain logic ports; the shell is rebuilt. `src/analyzer.mjs` and `src/semantic.mjs` are pure
and dependency-free, which is what makes this cheap.

1. `lib/contracts.ts` — both developers, together. Nothing else starts first.
2. Next.js scaffold + Clerk + Drizzle + Neon. CSS imported unchanged; `design-system.test.mjs`
   green on an empty shell.
3. Port `analyzer.mjs` → `lib/analyzer.ts`, `spanIsGrounded` → `lib/grounding.ts` **with the
   normalisation fix**. Tests port with them.
4. `lib/ai/*` — the four units against the contract. EvidenceJudge first; Verifier last.
5. Route handlers, then screens against fixtures, then wire.
6. Cut over when the golden path passes in both engines.

**The vanilla build stays deployed and untouched until the Next.js golden path is green.**
There is never a window with no working product.

---

## 11. Invariant compliance

| | How this design satisfies it |
|---|---|
| INV-1 | Cost figures and stack claims carry derivations; the retrieval deviation is recorded, not silent. |
| INV-2 | Per-criterion `engine` ends the overstated mode badge. Tailwind and retrieval deviations are stated. |
| INV-3 | Deterministic grounding on every verdict, plus quote-mining verification on `supported`. |
| INV-4 | The UI reports which criteria were semantically judged, and flags Verifier disagreement with both readings. |
| INV-5 | React escapes by default; `dangerouslySetInnerHTML` is banned outright. |
| INV-6 | Scope is the proposal's committed stack. Auth and Postgres are proposal scope, not new scope. |
| INV-7 | Typed errors; no criterion silently degrades without being labelled. |
| INV-8 | Deterministic fallback survives the port; the vanilla build stays live until cutover. |

---

## 12. Open questions

1. **Team availability.** The Day 2 recap cites internships blocking progress. The backlog
   assumes two developers plus three part-available teammates; it needs re-cutting if that
   is wrong.
2. **Free-tier reachability.** `src/semantic.mjs:50-53` records that on 10 Aug the AI Gateway
   free tier rate-limited every model. Verify the actual credit balance before relying on
   Gateway rather than a direct provider endpoint — the direct route works but loses provider
   diversity.
3. **Rubric editing after parse** needs CRUD endpoints, not detailed here.
4. **Export and deletion flow** — the UU PDP commitment needs a concrete endpoint.
