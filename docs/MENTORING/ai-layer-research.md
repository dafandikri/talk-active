# AI Layer Research — Talk-Active

**Date:** 2026-08-11 · **Horizon:** freeze at 13 Aug 18.00 WIB (~2 working days) · **Finals:** 14 Aug

Scope: the mentor's verifier suggestion, agent architecture, structured-output reliability,
speech-to-text, and cost. Everything below distinguishes **TRUE TODAY** (read from the repo,
cited by `file:line`) from **PROPOSED** (design docs, mentor suggestions, my recommendations).

---

## 1. Verdict

The AI layer you already have is closer to the mentor's suggestion than the suggestion assumes:
`src/semantic.mjs:165-169` and `:192-193` already run a **deterministic verifier** that rejects
any supporting verdict whose cited span is not literally present in the transcript, and
`:216-219` rejects the entire model pass when it grounds nothing. For the specific failure the
mentor is worried about — the judging model inventing a quote — a deterministic substring check
is strictly stronger, faster, and cheaper than an LLM verifier, and it is already proven by a
test (`test/semantic.test.mjs:60-76`). The residual error class an LLM verifier would add is
**quote-mining**: a span that is genuinely verbatim but does not actually support the criterion
it is filed under. That class is real and demo-visible, but closing it costs a second network
call inside a latency budget that is already mis-tuned (server 22s at `src/semantic.mjs:86`
versus client abort at 15s in `src/app.mjs:603`), plus new UI states for disagreement that
nobody has time to design. **Recommendation: do not add an LLM verifier before the freeze, and
do not migrate to the AI SDK, Next.js, Postgres, or Groq Whisper either.** Spend the two days on
five small, strictly-additive changes that raise the rate at which semantic mode actually
engages on stage and make the grounding you already do visible to a judge. The competing design
doc (`docs/MENTORING/2026-08-11-talk-active-app-layer-design.md`) is a good post-hackathon
roadmap and a bad pre-freeze plan; it was written against a blank directory and its §2
architecture would discard 130 passing tests, a green demo gate, and a deployed build to
re-derive capabilities the prototype already has.

---

## 2. Findings

### A) The verifier layer — "1 layer yang fokus ke verifikasi output dari Agent yang nge-judge"

#### A.1 — Yes, verification already exists, and it is deterministic

**TRUE TODAY.** Three mechanisms, all in `src/semantic.mjs`:

| Mechanism | Location | What it does |
|---|---|---|
| Literal span grounding | `src/semantic.mjs:165-169` | `spanIsGrounded()` lowercases both sides and requires `transcript.includes(span)`, with a 12-character floor so a one-word "quote" cannot pass |
| Per-verdict rejection | `src/semantic.mjs:192-193` | Any verdict with status `covered` or `partial` whose span fails grounding is **discarded**; that criterion silently keeps its deterministic verdict |
| Whole-pass rejection | `src/semantic.mjs:216-219` | If the model claimed support on ≥1 criterion and grounded **zero** of them, `SemanticUnavailable` is thrown and the chain moves to the next vendor (`src/semantic.mjs:345-348`) |

This is enforced in code, not in the prompt. The module header says so explicitly at
`src/semantic.mjs:13-14` ("A verdict that does not quote the transcript is rejected here, in
code, not merely discouraged in the prompt"), and it is the implementation of **AD-4**
(`docs/specs/2026-08-10-innovation-week.md:91`). The behaviour is locked by a test at
`test/semantic.test.mjs:60-76`, which feeds in a fabricated quote and asserts `SemanticUnavailable`.

**Say this plainly to the mentor.** For the check "did the judging model invent this quote?", a
substring comparison has 100% precision and 100% recall at 0 ms and $0. An LLM verifier asked the
same question would be slower, cost money, and be *less* accurate, because it can hallucinate the
answer to a question that has a decidable answer. Using a language model to check whether one
string occurs inside another is a strictly worse tool for that job. This is not a gap you are
filling with a second agent — it is a gap you closed with `String.prototype.includes`.

The product already tells the user this. `src/app.mjs:576` renders the semantic-mode label as
*"Evidence mapped by a language model, then checked against your transcript."* The second clause
is the verifier, and it is already on screen.

#### A.2 — What a deterministic check cannot catch

These are the residual classes. Ranked by how likely a finals judge is to notice one on stage:

1. **Quote-mining (relevance failure) — highest risk.** The span is verbatim and passes
   `spanIsGrounded()`, but it does not support the criterion it was filed under. Concretely: the
   default rubric has a criterion `Feasibility and trust | prototype, architecture, privacy,
   limitations` (`src/analyzer.mjs:22`). A model under pressure to produce *some* quote can
   return the sentence *"Talk-Active lets a student use the actual evaluation rubric while
   practicing a pitch."* (`src/analyzer.mjs:24`) — real, verbatim, passes every check in the
   file, and has nothing to do with feasibility or trust. The card at `src/app.mjs:549-557` would
   render it under the heading "Feasibility and trust" with the state "evidence found". A judge
   reading that card spots the mismatch in two seconds. **This is the one that can cost points.**

2. **Status inflation.** The span genuinely relates to the criterion, but only weakly, and the
   model returns `covered` where `partial` is honest. `src/semantic.mjs:200` maps `covered` → 100
   and `partial` → 55 with no independent check on which is right.

3. **Criterion misattribution.** The right span filed under the wrong `id`. `src/semantic.mjs:177`
   builds a `Map` keyed on whatever `id` the model emits and applies it wherever it lands; a
   swapped pair of ids produces two individually-grounded, individually-plausible, jointly-wrong
   cards.

4. **Over-quoting.** The model returns a 400-character paragraph that happens to contain the
   supporting clause. Verbatim, passes, but the "evidence" is now most of the transcript, which
   defeats the point of citing a span at all. There is currently **no upper length bound** in
   `spanIsGrounded()` (`src/semantic.mjs:165-169`) — an entire transcript pasted back as the span
   would pass.

5. **False negatives (missed coverage).** The model marks a criterion `missing` when the
   transcript does cover it. Note that this class is **structurally invisible to the verifier the
   competing doc proposes**: `docs/MENTORING/2026-08-11-talk-active-app-layer-design.md:73` and
   `:95-100` scope the Verifier to `"supported"` verdicts only, by design. So the LLM verifier
   would not catch this one either.

6. **Partial fabrication passes today.** `src/semantic.mjs:217` only rejects the pass when
   `grounded === 0`. If a model grounds 1 of 6 criteria and fabricates 5, the pass is **accepted**,
   the 5 fabricated verdicts are dropped back to their deterministic values, and the whole result
   is still labelled `mode: 'semantic'` at `src/semantic.mjs:344`.

7. **Silent partial coverage.** Nothing requires the model to return a verdict for *every*
   criterion. `src/semantic.mjs:184-186` iterates over `base.criteria` and returns the untouched
   deterministic criterion whenever `byId` has no matching entry. Your own failover test relies on
   this: `test/semantic.test.mjs:216-221` returns a single criterion for a four-criterion rubric
   and `:230` asserts `mode === 'semantic'`.

Classes 6 and 7 together produce the sharpest live-Q&A exposure in the current build: **the
result is labelled `semantic` as a whole, but individual criteria may be deterministic, and
nothing on screen or in the payload says which is which.** `src/app.mjs:576` tells the user
"Evidence mapped by a language model" for all of them. If a judge asks "did the model produce all
four of these?", the honest answer today is "we don't know from the response." That is an INV-2
and INV-4 exposure, and it is fixable with zero API calls (see §3, P1-b).

#### A.3 — Is an LLM verifier worth it two days out? No.

**Latency.** Per-attempt budget is 12 s and total chain budget 22 s (`src/semantic.mjs:85-86`).
The browser aborts the `/api/analyze` fetch at 15 s (`src/app.mjs:603`) and treats anything that
is not `mode === 'semantic'` as a miss (`src/app.mjs:613`). **These numbers already disagree**: a
chain that legitimately takes 16–22 s server-side is thrown away client-side and the demo shows
deterministic mode. A verifier call adds latency to a budget that is already over-subscribed
relative to what the client will wait for. Fix the mismatch first; do not spend the gap on a new
call.

**Cost.** Negligible — one batched verifier call over supported verdicts is roughly $0.001 (§2.E).
Cost is not the argument against it.

**Failure surface.** This is the argument. The competing doc's disagreement handling
(`docs/MENTORING/2026-08-11-talk-active-app-layer-design.md:110-129`) is five behaviours: record
`verifier_agreed = false`, show both readings, use an *effective* coverage score of 0.5 for
weakest-criterion ranking, never block the pipeline, and let a student override win. Step 3 is the
dangerous one — the weakest criterion drives the judge question (`src/analyzer.mjs:171,187`), which
drives the hero moment (`docs/specs/2026-08-10-innovation-week.md:42-46`) and the defense screen
(`src/app.mjs:660-668`). Changing the ranking function two days before a live pitch means the
question the judges hear is produced by logic that has had one day of testing. Steps 1, 2 and 5
need new payload fields, new copy that survives the INV-2 overclaim regexes
(`test/invariants.test.mjs:107-117`), and a card state the design at `src/app.mjs:533-572` does
not have.

**Verdict: skip it before the freeze.** You lose nothing in the pitch, because the honest answer
to the mentor is a *strength*, not a gap:

> "Yes — we verify, and the verification is deterministic. Every quoted span has to be a literal
> substring of the transcript or the verdict is thrown away and the criterion falls back to cue
> matching. For that specific check a string comparison beats a second model: it cannot
> hallucinate. What a second model would add is catching a quote that is real but off-topic for
> the criterion, and that is on our roadmap — we did not ship it this week because it costs a
> second network call inside a live-demo latency budget."

That answer is better than a rushed verifier, and it is defensible under follow-up.

#### A.4 — The cheap variant, if the team insists on shipping something

Two deterministic mitigations, no extra call, both landing inside `applySemanticVerdicts`:

- **Span length cap.** Reject a `covered`/`partial` span longer than ~300 characters or spanning
  more than two sentences. Catches class 4 outright. ~4 lines, one test.
- **Provenance field.** Tag each criterion `source: 'semantic' | 'deterministic'` and carry a
  count. Does not catch anything, but makes classes 6 and 7 *visible* instead of silent, which is
  what INV-4 actually asks for.

Do **not** add a lexical relevance gate (require the span to share a rubric cue token with the
criterion). It would catch some quote-mining, but it also re-imposes exactly the keyword
constraint that semantic mode exists to escape — a correct paraphrase with no shared cue token
would be discarded. That trade runs backwards.

If an LLM verifier ships at all, the only shape that is safe this week is: **one batched call over
all supported verdicts, run after a valid semantic result already exists, with its own short
timeout (~4 s), annotate-only.** Never blocking, never mutating a verdict, never changing the
weakest-criterion ranking. On failure or timeout, return the unmodified result. That is strictly
additive — worst case it degrades to today's behaviour. Even so: it is a P3, behind everything in
§3.

---

### B) Agent architecture — current hand-roll vs AI SDK vs agentic

#### B.1 — What is TRUE TODAY

`src/semantic.mjs` is a 359-line, zero-dependency module that POSTs OpenAI-compatible
`chat/completions` (`:243-256`) and walks a three-vendor chain (`:326-349`). Notable properties:

- **Provider diversity, not model diversity** — `:47-48` and `:67-74`: three vendors that share
  nothing but the gateway.
- **Two routes in.** `:30-33` — `TALKACTIVE_API_URL` overrides the Vercel gateway with any
  OpenAI-compatible endpoint, so a team with no gateway credits can reach semantic mode via
  Google AI Studio's free key (`.env.example`, ROUTE B).
- **Credentials bound to their endpoint** — `:38-45`: a custom URL never inherits
  `VERCEL_OIDC_TOKEN`. Tested at `test/semantic.test.mjs:129-154`.
- **Failover triggers on semantic invalidity, not just HTTP failure.** This is the important one.
  The catch at `:345-348` fires on network error, non-200, timeout, prose-instead-of-JSON, **and
  fabricated quotes**. A model that returns HTTP 200 with a plausible but ungrounded answer hands
  off to the next vendor. Proven at `test/semantic.test.mjs:236-246`.
- 16 tests cover this module; the full suite is **130 tests, all passing** (verified by running
  `node --test`).

#### B.2 — Migrating to AI SDK `generateText` + `Output.object()` through AI Gateway

First, a correction to the competing doc: it specifies `generateObject()`
(`docs/MENTORING/2026-08-11-talk-active-app-layer-design.md:60-62`). In AI SDK v6 `generateObject`
is deprecated in favour of `generateText` with `output: Output.object({ schema })`. The doc is
written against an older SDK surface; anyone implementing it verbatim would be writing deprecated
code on day one.

What migration would actually buy:

| Gain | Already have it? |
|---|---|
| Zod schema validation of the response | Partly — `src/semantic.mjs:161,173,186` validates shape and statuses by hand. Zod is tidier, not stronger. |
| Provider failover | **Yes, and better.** Gateway `providerOptions.gateway.models` fails over on provider *unavailability*. It does **not** retry when a provider returns HTTP 200 with a fabricated quote — which is your most valuable failover trigger (`src/semantic.mjs:345`). You would have to keep the hand-rolled loop anyway. |
| Cost tracking, `tags`, `user`, observability | **No — this is the one real gain**, and it matters after the hackathon, not during it. |
| Structured outputs via `response_format` | Available on the raw endpoint too (§C). No SDK required. |

Migration cost, honestly estimated:

- Add `ai` + `zod`: these would be the **first runtime dependencies in the project's history**
  (`package.json` has no `dependencies` or `devDependencies`; `pnpm-lock.yaml` is 9 lines and
  `node_modules/` is empty). The zero-dependency client is part of the feasibility argument
  (**AD-6**, `docs/specs/2026-08-10-innovation-week.md:93`). AD-6 does permit the server to use the
  AI SDK, so this is allowed — but it introduces an install step into the Vercel build that has
  never run. **30 min happy path, unbounded unhappy path, 2 days out.**
- Rewrite the call + parse path: ~1 h.
- Re-implement fabrication-triggered failover on top of the SDK: ~1 h (the loop survives).
- **Rewrite all 16 tests in `test/semantic.test.mjs`.** Every one injects `fetchImpl`
  (`test/semantic.test.mjs:31-37, 196-224`). The AI SDK needs a different seam. ~2 h, and it is
  the load-bearing part: these tests are the reason you can claim the demo survives a provider
  outage.
- **Total: 4–6 h of a ~16 h remaining budget, on the single most demo-critical module, to gain
  observability you cannot use before Friday.**

**Verdict: do not migrate before the finals.** Migrate after, for the Gateway tags and spend
dashboard.

#### B.3 — Is anything agentic justified here? No.

Blunt answer: **this is not an agent task.** Check it against the pattern tree:

- No external state to query. The transcript and the criteria are both in the prompt.
- No branching that depends on a tool result.
- No unbounded search — the output is exactly `N` verdicts for `N` criteria.
- The task is bounded classification + span extraction. `generateText` (or one `chat/completions`
  POST, which is what you have) is the correct primitive.

The only "loop" the problem contains is retry-on-invalid-output, and that is a `for` loop over
vendors at `src/semantic.mjs:326` — already written, already tested. A `ToolLoopAgent` would add
step nondeterminism, a `stopWhen` condition to get wrong, and more ways to exceed the 22 s budget,
in exchange for nothing.

Durable workflows (Workflow DevKit `DurableAgent`) solve crash-safe orchestration for tasks
running minutes to hours. Your entire pipeline is capped at 22 s (`src/semantic.mjs:86`). Not
applicable. The competing doc reaches the same conclusion for the same reason
(`docs/MENTORING/2026-08-11-talk-active-app-layer-design.md:61-63`) — that part of it is right.

The rubric-import feature (**A6**, `docs/specs/2026-08-10-innovation-week.md:127`) is also
single-shot extraction, not an agent. It is one more `chat/completions` call with a different
prompt and a different validator, reusing `src/semantic.mjs`'s existing plumbing.

---

### C) Structured output reliability — getting a verbatim span, every time

The single highest-value property is: every verdict cites a verbatim transcript span. Here is
what the current implementation is missing, ordered by how much each one raises the rate at which
semantic mode actually engages on stage.

**C.1 — No whitespace or punctuation normalisation in the grounding check.** `src/semantic.mjs:167-168`
lowercases and compares raw. A model reproducing a sentence that crosses a newline in a pasted
transcript will emit it with a space; typographic quotes (`"` vs `"`), ellipses (`…` vs `...`),
and en/em dashes routinely differ between what the user pasted and what the model returns. Every
one of those is a **false negative**: a correct, honest verdict silently discarded at
`src/semantic.mjs:193`, and the criterion quietly reverts to cue matching. This is the most
likely reason semantic mode under-delivers on stage, and the fix is ~8 lines of normalisation
applied to both sides before comparison. **Highest value-per-risk item in this document.**

**C.2 — The prompt does not demand character-level fidelity.** `src/semantic.mjs:113-114` says
*"quote the exact sentence from the transcript that justifies it, copied verbatim."* Models read
"verbatim" as "faithfully", not as "character for character", and routinely repair typos, drop a
trailing period, or trim a leading conjunction. Adding one clause — copy the characters exactly,
including punctuation and any errors; do not repair or trim — is free and directly raises the
grounding hit rate.

**C.3 — No `response_format`.** The comment at `src/semantic.mjs:249-250` states *"No
response_format: the gateway rejects it outright ('Invalid input')."* **The current Vercel AI
Gateway documentation contradicts this**: `/v1/chat/completions` accepts
`response_format: { type: 'json_schema', json_schema: { name, description, schema } }` and also a
flat `{ type: 'json', name, description, schema }` form
(vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs). The most
likely explanation for the observed rejection is that the attempt used the OpenAI `{ type:
'json_object' }` form, or the wrong nesting. **Worth a 10-minute empirical retest with the
documented shape** — but ship it guarded: send `response_format` only for the primary model, and
on a 400 retry once without it before moving to the next vendor. Not all three vendors in the
chain support it identically, and the direct-Google route (`src/semantic.mjs:30`) is a different
endpoint with different rules. `extractJson()` (`src/semantic.mjs:141-159`) already copes with
fences and stray prose, so this is an improvement, not a prerequisite.

**C.4 — No `max_tokens` / `max_completion_tokens`.** `src/semantic.mjs:251-253` deliberately omits
a token cap because vendors disagree on the parameter name. The consequence is untested in the
other direction: a long transcript plus a ten-criterion finals matrix could produce a **truncated**
JSON response, which `extractJson()` will fail to parse and which then costs a whole vendor slot
out of the 22 s budget. Low probability, but it is the failure mode most likely to bite precisely
during the hero moment, because the hero moment uses the *largest* rubric you will ever paste
(`docs/specs/2026-08-10-innovation-week.md:44`). Mitigation for this week is not a token cap — it
is **rehearsing the hero moment against the real finals matrix and measuring the wall-clock time**,
which spec item D2 already requires.

**C.5 — No span length ceiling.** Covered in §A.2 class 4.

**C.6 — No retry-with-stricter-prompt.** The competing doc proposes retry-once-then-degrade
(`docs/MENTORING/2026-08-11-talk-active-app-layer-design.md:270-272`). The current code instead
moves to the **next vendor** on the same failure (`src/semantic.mjs:345-348`). For a live demo
this is the better trade: a different vendor is more likely to succeed than the same model with a
sterner prompt, and it costs the same one round trip. **Do not add retry.** It would consume the
22 s budget for a lower success probability.

**C.7 — The model's own reasoning is captured and thrown away.** `src/semantic.mjs:210` stores
`rationale` (the model's one-sentence `why`), and nothing in `src/app.mjs` ever renders it — the
evidence card at `src/app.mjs:533-572` shows the quote and the missing cues only. Rendering it
under the blockquote is a free strengthening of INV-3 with zero API cost and zero latency: the
card goes from *"here is a quote"* to *"here is a quote, and here is why it counts."* `textContent`
only, per INV-5.

---

### D) Speech-to-text — Web Speech API vs Groq Whisper for a live Indonesian demo

#### D.1 — What is TRUE TODAY

`setupDictation()` at `src/app.mjs:921-995` uses the browser Web Speech API:

- Feature-detects and degrades honestly: `src/app.mjs:922-928` disables the button, sets the label
  to "Dictation unavailable", and the tooltip to "Paste a transcript instead."
- Continuous with interim results (`src/app.mjs:942-943`), so text appears on screen **as you
  speak** (`src/app.mjs:951-959`). On stage, that is the visually compelling part.
- Bilingual by explicit choice, not auto-detection. `src/app.mjs:975-977` documents the real
  constraint: the API recognises one language per session and cannot detect a mid-sentence switch,
  so the language is read from the picker at the moment recording starts (`:979`) and the picker
  restarts recognition if changed mid-session (`:985-993`).
- Has an error path that keeps captured text (`src/app.mjs:969-972`).

#### D.2 — Comparison for a live demo on venue wifi

| | Web Speech API (today) | Groq `whisper-large-v3-turbo` (proposed) |
|---|---|---|
| Key / account | None | Groq key, shared daily quota |
| Cost | $0 | $0.04/hr audio; free tier 28,800 audio-sec/day, 2,000 req/day, shared across all users on one key |
| Network dependency | Yes (Chrome ships audio to Google) | Yes (upload the whole blob first) |
| Time to first visible text | Immediate, streaming | Nothing until the upload **and** the transcription complete |
| Failure on venue wifi | Degrades to captured-so-far text + a message (`src/app.mjs:969-972`) | Upload stalls; nothing to show |
| Browser support | Chrome/Edge in practice; already handled (`src/app.mjs:922-928`) | Any browser with `MediaRecorder` |
| Indonesian / code-mixed accuracy | Unmeasured; one language per session | Plausibly better, **also unmeasured** — the competing doc admits at `:174-176` that no Indonesian WER is published and it "needs an empirical check" |
| Raw-audio invariant | **Architecturally impossible to violate** — the API never hands the app an audio buffer | A policy you must defend in code review; the doc's own §5.4 (`:202-204`) makes discarding the buffer a discipline, not a guarantee |
| Build cost before freeze | Zero (shipped) | Recorder UI + upload route + quota guard + failure state + empirical accuracy check. Hours. |
| In sprint scope? | Yes | **No** — "audio recording and transcription" is on the explicit out list at `docs/specs/2026-08-10-innovation-week.md:76-77` |

#### D.3 — Verdict

**Web Speech is lower risk on stage, and Groq is out of scope by written decision.** Three reasons
that matter beyond the table:

1. **The raw-audio invariant.** "Raw audio is not persisted" (`AGENTS.md:192`) is currently not a
   promise — it is a fact about the architecture. The app never receives audio bytes. Switching to
   Groq converts a guarantee into a code-discipline claim you have to defend in Q&A, and hands a
   judge an obvious follow-up ("where does the buffer go?"). Do not trade that away in two days.

2. **The offline laptop.** Spec item E3 (`docs/specs/2026-08-10-innovation-week.md:165`) requires
   the full demo to run with wifi physically disabled. **Neither** option works offline — Chrome's
   Web Speech sends audio to Google's servers. So dictation is already excluded from your
   worst-case demo path, and that is correct. Note this does **not** trip the demo gate: the
   `no-external-dependencies` check (`scripts/demo-gate.mjs:282-288`) inspects page resource
   requests, not the browser's internal speech service.

3. **The lowest-risk option on stage is neither.** It is a pre-pasted transcript. The venue-wifi
   risk is already rated High likelihood in the register (`docs/specs/2026-08-10-innovation-week.md:244`).

**Concrete recommendation:** keep dictation as a 20-second flourish at the **booth**, where a
retry costs nothing and "watch it listen to me in Indonesian" is a great visitor moment. Keep it
out of the 7-minute pitch's critical path — minute 4 uses a transcript that is already in the
textarea. If it is used on stage at all, rehearse it once on the actual venue wifi or the phone
hotspot, and extend spec item D2's scripted recovery line (`:154`) to cover dictation failing, not
just the API.

---

### E) Cost

#### E.1 — Per-analysis inference cost on the current chain

Model chain and prices are the team's own figures, verified live against the gateway on 10 Aug 2026
(`src/semantic.mjs:50-66`): `anthropic/claude-haiku-4.5` at $1.00 / $5.00 per M tokens,
`openai/gpt-5-nano` at $0.05 / $0.40, `google/gemini-2.5-flash-lite` at $0.10 / $0.40.

Token estimate for one evidence-mapping call (system prompt at `src/semantic.mjs:104-134` plus the
criteria list and transcript):

| Input | Short attempt (90 s, ~210 words, 4 criteria) | Hero moment (7 min, ~1,000 words, 10-criterion finals matrix) |
|---|---:|---:|
| System prompt | ~200 tok | ~200 tok |
| Criteria list | ~150 tok | ~400 tok |
| Transcript | ~300 tok | ~1,400 tok |
| **Total in** | **~650 tok** | **~2,000 tok** |
| Output (verdict + span + missing + why, per criterion) | ~400 tok | ~800 tok |

On the primary (`claude-haiku-4.5`):

- Short attempt: 650 × $1/M + 400 × $5/M = **$0.0027**
- Hero moment: 2,000 × $1/M + 800 × $5/M = **$0.0060**

This matches the repo's own stated figure of "about $0.004 per analysis" (`src/semantic.mjs:65`).
At Rp16,500/USD that is **Rp45–99 per analysed attempt**, call it **~Rp65 typical**.

Two things that make the real number lower still:

- **Response caching.** `api/analyze.mjs:22-46` caches semantic results by SHA-256 of
  `(duration + rubric + transcript)`, and deliberately caches *only* semantic results
  (`api/analyze.mjs:43-44`) so one blip does not pin the session to deterministic mode. A rehearsed
  stage demo re-running the same transcript costs $0 after the first call.
- **Failover only costs on success.** A vendor that 403s or 429s answers in well under a second
  (`src/semantic.mjs:77-79`) and bills nothing.

#### E.2 — What that implies for the proposal's Rp900–1,800/session claim

The proposal states at `docs/proposal/body.tex:404-408`: *"A full analysed session costs an
estimated Rp900–1,800, so a Pro subscriber carries a gross margin above 70%, and the free tier's
three-session cap bounds subsidy to roughly Rp5,400 per user per month."* The grill findings use
Rp1,500/session as the cost-plus anchor for the Campus tier
(`docs/MENTORING/Talk-Active_Grill_Findings.md:14-19`).

A fully-loaded session in the *target* product — not just today's single call — is:

| Component | Est. cost | Note |
|---|---:|---|
| Rubric parse (Sonnet-class, ~1.5k in / 800 out) | $0.017 | Once per project; amortised over 3–6 sessions → **$0.003–0.006** |
| Evidence mapping | $0.003–0.006 | Measured above |
| Question generation (stronger tier) | ~$0.005 | Currently deterministic (`src/analyzer.mjs:115-133`), $0 today |
| Defense evaluation | ~$0.002 | Currently deterministic (`src/analyzer.mjs:200-238`), $0 today |
| STT, 7 min via Groq turbo | ~$0.005 | Only if D is adopted; $0 today |
| Retry / failover overhead | +30% | |
| **Total** | **~$0.018–0.027** | **≈ Rp300–450** at Rp16,500/USD |

**The proposal's estimate is conservative by roughly 3–5×, and that is the right direction to be
wrong in.** Nothing needs changing. Three implications:

1. **The Pro-tier margin claim strengthens.** Rp39k/month against Rp300–450/session leaves the
   ">70% gross margin" statement true with a large buffer.
2. **The free-tier subsidy bound holds a fortiori.** Rp5,400/user/month is the stated ceiling;
   actual is closer to Rp900–1,350.
3. **The Campus cost-plus anchor is unaffected** — it uses Rp1,500 as an upper bound, which is
   still an upper bound.

**Prepare this as a Q&A answer**, because a mentor asking about pricing will ask again on Friday:

> "On the model we actually run today, one analysed attempt costs about Rp65. Rp900–1,800 in the
> proposal is a deliberate upper bound for the full pipeline — a stronger model for rubric
> parsing, question generation, transcription, and retry headroom — plus room for model prices to
> move. We would rather over-budget the cost line than discover it."

Add the derivation somewhere traceable before Friday. INV-1 says every external fact needs a
source; right now the Rp900–1,800 figure has no visible worked derivation anywhere in the repo,
and "estimated" is doing the load-bearing work. A five-line footnote with the token math closes
that.

#### E.3 — Budget for the competition itself

At ~$0.004/analysis, **$5 of credits covers ~1,250 analyses** — more than the entire event will
consume. But note a discrepancy worth resolving on Day 3:

- The AI Gateway documentation states every Vercel team gets **$5 of free AI Gateway credits per
  month**, refreshing every 30 days, starting on first request.
- The repo's own live observation says the opposite: *"The FREE tier rate-limits every model with
  a 429 telling you to top up. Paid credits are required for any of this to work at all"*
  (`src/semantic.mjs:50-53`), repeated in `.env.example`.

The empirical observation from 10 Aug wins over documentation, but the gap is worth 10 minutes:
check the team's actual gateway credit balance. If the $5 monthly credit is available, semantic
mode is free for the whole competition through Route A. If it is not, **Route B (Google AI Studio
direct, `src/semantic.mjs:30-33`) is the working free path** and should be configured and rehearsed
as the fallback credential, not discovered on Friday morning.

One caveat on Route B: when `TALKACTIVE_API_URL` points at Google, the chain must also be
overridden with `TALKACTIVE_MODELS` (documented in `.env.example`), because the default chain uses
gateway-style slugs Google will reject. And all three entries then come from **one vendor** — the
provider-diversity property described at `src/semantic.mjs:47-48` is lost. Route B buys free
semantic mode at the cost of single-vendor risk. Worth knowing which trade you are on when you
walk on stage.

---

## 3. Recommended AI layer for the next 48 hours

Ranked by value-per-risk. Every item is independently shippable, strictly additive, and leaves the
demo path working if it is skipped. Nothing here adds a dependency, a network call, or a UI state.

### P0 — do these first

**P0-a · Reconcile the client and server timeout budgets.**
`src/semantic.mjs:86` allows the chain 22 s; `src/app.mjs:603` aborts at 15 s. A chain that
legitimately succeeds in 16–22 s is discarded and the demo shows deterministic mode. Either raise
the client abort to ~25 s or lower `DEFAULT_TOTAL_BUDGET_MS` to ~13 s. Prefer lowering the server
budget — a judge waiting 22 s is already a bad outcome, and `src/semantic.mjs:80-84` notes the
budget was raised for `gpt-5-nano`'s reasoning latency, so consider dropping that model from the
chain instead of paying for it in the budget. **One line + one test. Directly protects the hero
moment.** Size: S.

**P0-b · Normalise whitespace and punctuation in `spanIsGrounded()`.**
`src/semantic.mjs:165-169`. Collapse runs of whitespace, normalise typographic quotes, dashes and
ellipses on both sides before the `includes()` check. This is almost certainly the largest single
cause of semantic mode under-engaging, and every false negative it fixes is a correct verdict you
are currently throwing away. Keep the 12-character floor. Add a test with a span crossing a
newline. Size: S.

### P1 — do these next

**P1-a · Harden the prompt for character-level fidelity.**
`src/semantic.mjs:113-114`. Add one clause to rule 2: copy the characters exactly, including
punctuation; do not repair typos, do not trim. The prompt-shape test at `test/semantic.test.mjs:163-172`
already asserts on this content and will need one line. Free, no latency, no cost. Size: S.

**P1-b · Per-criterion provenance, and say the number out loud.**
Today the response is labelled `semantic` as a whole (`src/semantic.mjs:344`) while individual
criteria may silently be deterministic (§A.2 classes 6–7). Add `source: 'semantic' | 'deterministic'`
to each criterion in `applySemanticVerdicts`, plus a count, and change the review copy at
`src/app.mjs:576` from a blanket claim to a checkable one — e.g. *"3 of 4 criteria were mapped by a
language model and checked against your transcript; the rest fell back to cue matching."* Zero API
cost, zero latency, strengthens INV-2, INV-3 **and** INV-4 at once, and gives the pitch a concrete
honest sentence that a judge can verify on screen. **This is the item that answers the mentor's
verifier question in the pitch.** Size: M.

**P1-c · Render the model's rationale on the evidence card.**
`src/semantic.mjs:210` already captures it; `src/app.mjs:549-557` already has the card. Add one
`<p>` under the blockquote, `textContent` only (INV-5). Free evidence surface. Size: S.

### P2 — only if P0 and P1 are green and the gate is passing

**P2-a · Span length ceiling.** Reject supporting spans over ~300 characters in
`spanIsGrounded()`. Closes the over-quoting class. Size: S.

**P2-b · Guarded `response_format: json_schema` on the primary model.**
Re-test the documented gateway shape (§C.3). Send it only for the first model in the chain; on a
400, retry once without it, then fall through to the next vendor as today. If the retest fails,
**update the stale comment at `src/semantic.mjs:249-250` with what was actually rejected** and move
on. Size: M. Risk: the highest of anything in this list — it touches the request body on the
demo-critical path. If it is not green by 12 Aug evening, drop it.

**P2-c · Rehearse the hero moment against the real 10-criterion finals matrix and record the
wall-clock time.** Not a code change; it is the measurement that tells you whether P0-a's budget is
right and whether C.4's truncation risk is real. Should happen anyway per spec D2. Size: S.

### P3 — the mentor's verifier, in its safe shape

Only after everything above, and only in the shape described in §A.4: one batched call over
supported verdicts, run **after** a valid semantic result exists, its own ~4 s timeout,
**annotate-only** (`flaggedForReview: true`), never mutating a verdict, never touching the
weakest-criterion ranking. On any failure, return the result unchanged. Realistically this does not
fit before the freeze, and that is fine — see §A.3 for the answer that makes it a non-issue in Q&A.

### Explicitly NOT before the freeze

| Rejected | Why |
|---|---|
| Next.js 15 + Clerk + Postgres/Drizzle rewrite (`docs/MENTORING/2026-08-11-talk-active-app-layer-design.md:27-48`) | Discards 130 passing tests, a green demo gate, and a live deployment to re-derive existing capability, two days out. The doc's own §1 (`:6`) says it assumes "no existing prototype code to build on" — that assumption is false. |
| AI SDK migration | 4–6 h, on the most demo-critical module, for observability you cannot use before Friday. Loses fabrication-triggered failover unless re-implemented anyway. §B.2. |
| Groq Whisper STT | Out of scope by written decision (`docs/specs/2026-08-10-innovation-week.md:76-77`); converts an architectural raw-audio guarantee into a code-discipline claim. §D. |
| Agentic loops, tools, DurableAgent | Bounded classification task capped at 22 s. §B.3. |
| Retry-with-stricter-prompt | Next-vendor failover is the better use of the same round trip. §C.6. |
| Auth, cloud sync, per-user rate limiting | Already out of scope (`docs/specs/2026-08-10-innovation-week.md:76-77`). |

---

## 4. Post-hackathon

Once the finals are over and the deadline pressure is off, the competing design doc becomes a
reasonable roadmap. Sequence it so each step is independently reversible:

1. **AI SDK + Gateway migration, for observability.** `generateText` + `Output.object()` (not the
   deprecated `generateObject`), with `providerOptions.gateway.tags` for per-feature cost
   attribution and `user` for per-user tracking. **Keep the hand-rolled outer failover loop** —
   Gateway model fallback does not retry on a semantically-invalid HTTP 200, and that trigger is
   the thing that makes INV-3 hold in production. Port the 16 tests first, then swap the transport.

2. **The LLM verifier, properly.** The design at
   `docs/MENTORING/2026-08-11-talk-active-app-layer-design.md:95-129` is sound once there is time
   to build the disagreement UI. Two changes to it: (a) drop the "supported verdicts only" scoping
   or at least measure false negatives separately, since the current scoping is blind to
   missed-coverage errors by construction (§A.2 class 5); (b) evaluate it against a labelled set
   before trusting it — an unmeasured verifier is a second opinion, not a verification.

3. **Build an eval set before building anything else that touches judgement quality.** 20–30
   hand-labelled (transcript, criterion, correct verdict, correct span) tuples from real student
   rehearsals. Without it you cannot tell whether a prompt change, a model swap, or a verifier
   helped or hurt. Everything in §2.A is currently reasoned from first principles because there is
   no measurement. This is the highest-leverage post-hackathon investment and it costs no
   engineering, only labelling time.

4. **Per-criterion parallel calls.** The competing doc argues for per-criterion over batched
   (`:88-93`) on span-misattribution grounds. That reasoning is plausible and directly targets
   §A.2 class 3 — but it is an empirical claim. Test it against the eval set from step 3 before
   adopting it; it multiplies request count by N, which changes both the cost model and the rate-limit
   exposure.

5. **Persistence and accounts.** Postgres + Clerk per the design doc, once there is a reason to
   sync across devices. Note that the current `localStorage` workspace is a genuine privacy feature,
   not only a shortcut — worth keeping a local-only mode.

6. **Groq Whisper, with the invariant written into the code path.** If STT moves server-side, the
   "audio is never persisted" property needs a test that asserts it, not a comment that claims it.
   And measure Indonesian/code-mixed WER against real samples before putting an accuracy number in
   any pitch deck — INV-1 and INV-2 both apply.

7. **Rubric-import (A6) as a second single-shot extraction call.** Reuse `src/semantic.mjs`'s
   transport, chain, and validation. The validator for this one is different: the output is
   criteria, so the grounding check becomes "does every generated criterion label trace to a span
   in the pasted matrix?" — the same deterministic-verifier idea, applied to a different artifact.

---

### Sources

- Repo (read directly): `AGENTS.md`, `src/semantic.mjs`, `src/analyzer.mjs`, `src/app.mjs`,
  `api/analyze.mjs`, `test/semantic.test.mjs`, `test/invariants.test.mjs`, `scripts/demo-gate.mjs`,
  `package.json`, `vercel.json`, `.env.example`, `docs/proposal/body.tex`,
  `docs/specs/2026-08-10-innovation-week.md`, `docs/MENTORING/2026-08-11-talk-active-app-layer-design.md`,
  `docs/MENTORING/Talk-Active_Grill_Findings.md`. Test count verified by running `node --test` (130 pass).
- [Vercel AI Gateway — Structured Outputs (OpenAI Chat Completions)](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs)
- [Vercel AI Gateway — Chat Completions endpoint](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/chat-completions)
- [AI SDK — Providers and Models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [Groq Speech-to-Text (Whisper) API: Pricing, Capabilities & Alternatives (2026)](https://apio.sh/apis/groq-speech-to-text)
- [Groq pricing in 2026: every model, free tier, and hidden discounts explained](https://www.eesel.ai/blog/groq-pricing)
- Model prices for the active chain are the team's own live verification of 10 Aug 2026, recorded
  at `src/semantic.mjs:50-66`. USD→IDR conversions in §E use Rp16,500/USD; restate if the rate has moved.
