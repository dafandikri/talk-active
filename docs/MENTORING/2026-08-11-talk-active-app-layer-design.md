# Talk-Active — App Layer Design (Innovation Week Sprint)

**Date:** 2026-08-11
**Status:** Approved by user, ready for implementation planning
**Sprint window:** 10–14 Aug 2026 (this design starts on day 2)
**Scope:** Full MVP app layer, built from a blank repo — no existing prototype code to build on.

## 1. Context

Talk-Active is a rubric-grounded rehearsal workspace: a student enters an evaluator's real
rubric, rehearses a pitch/defense/interview answer, and the system maps every claim to a
criterion, cites the exact transcript span that does or doesn't satisfy it, generates the
adversarial question a skeptical evaluator would ask about the weakest claim, and scores
the student's defense of that claim. Progress (recurring gaps) is tracked per criterion
across attempts.

Source: `Preliminary_RistekHackathon2026_fam.pdf` (Ristek Hackathon 2026 preliminary
proposal, Team FAM). Section 4 of that document specifies the target architecture and tech
stack this design implements; this document works out the application layer in enough
detail to hand off to implementation planning.

Full MVP scope was chosen deliberately even with ~3 days left in the sprint, since the repo
is starting from zero — better to have one coherent plan than bolt pieces on ad hoc.

## 2. Architecture

Single Next.js 15 (App Router) project on Vercel. No separate backend service.

```
app/
  (marketing)/                      landing page
  (app)/
    dashboard/                      project list
    projects/[id]/                  rubric editor, attempt, evidence, progress
  api/
    rubrics/parse/route.ts              rubric ingestion (LLM structure + confirm)
    projects/[id]/rubric/route.ts       save confirmed rubric
    attempts/route.ts                   create attempt (paste or record)
    attempts/[id]/transcribe/route.ts   audio -> STT -> transcript
    attempts/[id]/evidence/route.ts     evidence mapping (core rubric-grounded step)
    attempts/[id]/question/route.ts     question generation from weakest claim
    attempts/[id]/defense/route.ts      defense answer scoring
    progress/[projectId]/route.ts       recurring-gap aggregation
lib/
  ai/            AI SDK wrappers, Zod schemas, Gateway model strings
  db/            Drizzle schema + queries
  services/      pipeline logic, framework-agnostic from route handlers
```

- **Client:** React Server Components for read views (dashboard, progress); Client
  Components for the recorder and the interactive evidence review.
- **Compute:** every `api/*` route is a Vercel Function on Fluid Compute (Node.js runtime,
  not Edge) — needed for full Node APIs and the AI SDK.
- **AI:** all text-generation LLM calls go through Vercel AI Gateway using plain
  `"provider/model"` strings (no direct `@ai-sdk/anthropic`-style package), so provider
  failover on outage is automatic. Speech-to-text is the one exception — see §5.
- **Auth:** Clerk middleware gates everything under `(app)`. No local `users` table; Clerk's
  user ID is stored directly as the `user_id` foreign key on `projects`.
- **Pipeline pattern:** plain Route Handlers calling `generateObject()` with Zod schemas —
  not Vercel Workflow/WDK. Chosen over durable-workflow orchestration because the team has
  3 days and no prior WDK experience; resilience instead comes from retry-once-then-degrade
  logic per call (§6), not framework-level durability.

## 3. AI units

Not agentic loops — four narrowly-scoped, schema-constrained calls, reused across the
pipeline's touchpoints:

| Unit | Job | Input → Output | Model tier |
|---|---|---|---|
| **RubricParser** | Structure raw rubric text/file into criteria | text/file → `Criterion[]` (name, description, required evidence) | Stronger (Sonnet-class) — runs once per project, quality compounds downstream |
| **EvidenceJudge** | Decide if one criterion is supported by the transcript | transcript + 1 criterion → `{verdict, span, missing}` | Small/fast (Haiku-class) — runs per criterion, in parallel, most often per session |
| **Verifier** | Independently re-check `"supported"` verdicts only | criterion + required evidence + cited span → `{agrees: boolean}` | Small/fast — scoped input, cheap |
| **QuestionGenerator** | Write the one adversarial question | weakest criterion + missing evidence + source docs → 1 question | Stronger — the product's core differentiator, worth the extra quality |

Exact model IDs are not pinned here — fetch the live list at implementation time via
`curl -s https://ai-gateway.vercel.sh/v1/models | jq ...` (per the AI SDK skill) and pick
the newest model in each tier.

**EvidenceJudge is reused twice**: once per criterion at evidence-mapping time, and again
(scoped to the criterion targeted by the generated question) at defense-evaluation time,
judging the student's answer instead of the original transcript.

**Progress has no AI unit.** Recurring-gap tracking is a plain SQL aggregation over stored
verdicts — zero model calls, consistent with the product's "no invented ability scores"
stance (§7).

### Why EvidenceJudge runs per-criterion, not batched

Decided: **per-criterion, parallel** (`Promise.allSettled`), not one batched call across all
criteria. Reasoning: focused single-criterion context reduces span-misattribution risk, and
parallel execution means latency is comparable to a single batched call anyway. Typical
rubrics run 4–6 criteria, so the cost delta over batching is small.

### Why Verifier is scoped to `"supported"` verdicts only

The failure modes are asymmetric. A false `"unsupported"` costs the student one extra,
mildly unfair rehearsal question — annoying, not harmful. A false `"supported"` sends them
into the real evaluation believing a gap is covered — genuinely damaging. Verifier spend is
concentrated where a mistake actually hurts, not doubled across every criterion.

Verifier does **not** produce a percentage-confidence score. A single LLM call self-reporting
"73% confident" is not a calibrated probability — it's a plausible-sounding guess. Instead,
Verifier gives a binary `agrees: true/false`; disagreement flips the verdict to "needs
review" and both readings are shown to the student, rather than asserting a verdict neither
agent is confident in. This also keeps faith with the product's explicit "no ability/
confidence scores" design constraint (Section 4.4 of the source PDF) — that constraint is
read here as covering *verdict-trust* signals too, not only student-facing ability scores.

**What happens on disagreement, concretely:**

1. `evidence_verdicts.verdict` stays `"supported"` (EvidenceJudge's original call), but
   `verifier_agreed` is set to `false` — the disagreement is recorded, not silently
   resolved by picking a winner.
2. The UI shows both readings: "Cited as supporting evidence: '\<span\>' — flagged for
   review, a second pass wasn't confident this fully satisfies the criterion." Never
   silently rendered as a clean "Supported ✓".
3. **Ranking treats it as uncertain, not as satisfied.** Whichever criterion is picked as
   "weakest" for QuestionGenerator uses an *effective* coverage score, and a
   `verifier_agreed = false` row is scored as `0.5` (same as `"partial"`) for that ranking,
   even though the stored `verdict` field is untouched. This biases the system toward
   re-examining exactly the claims it isn't sure about — disagreement increases scrutiny,
   it never decreases it.
4. **The pipeline is never blocked.** A flagged verdict doesn't halt evidence mapping or
   question generation — it's just more likely to become the thing the judge question
   targets.
5. **Student override wins.** If the student manually confirms or overrides a flagged
   verdict, `student_overridden = true` and `student_override_verdict` take precedence over
   both AI readings for all downstream scoring and progress aggregation.

### Why QuestionGenerator exists

Without it, Talk-Active is a rubric-coverage linter — passive "here's what's missing."
QuestionGenerator is what converts the loop from feedback into rehearsal: the student must
defend the weakest claim out loud, under simulated pressure. Concretely:

- Defense evaluation (an EvidenceJudge reuse) has nothing to score without a question to
  answer.
- The target metric "≥60% of students revise a specific claim after the evidence review"
  (source PDF Table 6) is driven by being asked a pointed question, not by reading a report.
- It's the one capability competitors (Yoodli/Orai/Poised) don't have — Table 2 of the
  source PDF shows none of them generate a question from the weakest claim. It's cheap (one
  short call) and the hardest thing to bolt onto a delivery coach after the fact, so under
  time pressure it is not the thing to cut — ASR is the safer cut, since paste is already
  the stated fallback path.

## 4. Endpoints

| Endpoint | Method | AI call(s) | What happens |
|---|---|---|---|
| `/api/rubrics/parse` | POST | RubricParser ×1 | Pasted text or uploaded file (extracted to text via a non-AI PDF-parse step first) → draft `Criterion[]` returned for review. Nothing persisted yet. |
| `/api/projects/[id]/rubric` | POST | none | Student-confirmed criteria persisted. The system never silently guesses what an evaluator meant. |
| `/api/attempts` | POST | none | Creates an attempt row (`draft`/`recording` mode) under a project. Returns `attemptId`. |
| `/api/attempts/[id]/transcribe` | POST | Groq Whisper (STT) | Audio blob → transcript text + timestamps. Paste-mode attempts skip this and `PATCH` the transcript directly. |
| `/api/attempts/[id]/evidence` | POST | EvidenceJudge ×N parallel + Verifier ×(supported count) | Per criterion: locate candidate spans, EvidenceJudge returns verdict + citation, app code rejects any verdict whose span isn't a literal substring of the transcript, Verifier double-checks `"supported"` verdicts. Persists per-criterion verdicts, returns the evidence map + weakest criterion. |
| `/api/attempts/[id]/question` | POST | QuestionGenerator ×1 | Weakest criterion + missing evidence + source docs → one adversarial question, persisted. |
| `/api/attempts/[id]/defense` | POST | EvidenceJudge ×1 (scoped) | Student's answer judged against the same target criterion only. Same citation-or-reject rule applies. |
| `/api/progress/[projectId]` | GET | none | SQL aggregation: average coverage per criterion across all attempts in the project, surfaces the most-recurring gap. |

Every AI-touching route: call model → validate citation against the actual transcript in
code → write to Postgres → return. Validation failure → retry once with a stricter prompt →
fall back to a safe default rather than show an unverified verdict (§6).

## 5. Speech-to-text

**Groq Whisper (`whisper-large-v3-turbo`)**, called directly via `@ai-sdk/groq`'s
`transcribe()` — **not** routed through Vercel AI Gateway.

- Free tier: 2,000 requests/day, 28,800 audio-seconds/day (8 hrs) — comfortably covers the
  sprint demo and the planned ten-student validation study.
- Paid overflow: $0.04/hour of audio — 89% cheaper than OpenAI's Whisper API.
- Speed: ~217–228x realtime — an hour of audio transcribes in ~15s, fine for a live demo.
- Handles Indonesian and ID/EN code-mixing, matching the source PDF's hard requirement.
  Both Whisper models are multilingual (99+ languages, ~12% aggregate WER); no
  Indonesian-specific WER is published, so this needs an empirical check early in the
  sprint against a few real Indonesian/code-mixed samples, not just trusted from docs.
- Free-tier file size cap is 25MB per request (dev tier: 100MB) — well above a few minutes
  of compressed speech, but the binding limit is Groq's, not Vercel Function's 100MB body
  limit.

Why not through the Gateway: Gateway's STT routing is beta and requires an AI SDK canary
release — real instability risk this close to a demo. Calling Groq directly loses automatic
provider failover on this one call, but paste-draft is already the PDF's stated fallback if
transcription fails, so that gap is covered elsewhere.

### Technical flow

1. **Capture** — browser `MediaRecorder` API records to a Blob (webm/opus) client-side.
   Recorded at a modest bitrate to keep upload size small — a few minutes of speech is well
   under any size limit.
2. **Upload** — the Blob is POSTed to `/api/attempts/[id]/transcribe` as the raw request
   body. Vercel Functions accept bodies up to 100MB, far more than a rehearsal recording
   needs, so no chunking/streaming upload is required.
3. **Transcribe** — the route handler calls `transcribe()` from the AI SDK with the
   `@ai-sdk/groq` provider, model `whisper-large-v3-turbo`, passing the audio buffer plus
   `language: "id"` as the default hint — Groq's docs state an ISO-639-1 language hint
   improves both accuracy and latency, and most rehearsals are primarily Indonesian with
   embedded English terms, which Whisper generally handles fine even with a primary-language
   hint set. Full English sessions (e.g. an LPDP English-language interview) should be a
   per-attempt toggle the student sets, not silently auto-detected.
4. **Discard + persist** — the response gives transcript text + timestamped segments. The
   audio buffer is never written to Blob storage or disk; only the transcript text and
   `audio_duration_seconds` are written to `attempts`, then the buffer is dropped. This is
   what makes "audio is transcribed then discarded" true in code, not just in the docs.
5. **Quota guard** — Groq's free tier (28,800 audio-seconds/day) is a shared quota on one
   API key, not per-student. The Upstash Redis rate limiter tracks cumulative daily
   audio-seconds against that cap; as it's approached, the recorder UI nudges toward paste
   instead of silently failing once the cap is hit mid-demo.
6. **Failure** — Groq timeout or 5xx → attempt status becomes `transcribe_failed`, UI offers
   "try recording again" or "paste your draft instead," per the retry-once-then-degrade
   pattern in §7.

## 6. Data model (Postgres)

No separate `users` table — Clerk's user ID is stored directly as `user_id text` on
`projects`.

```
projects
  id, user_id (clerk id), title, event_context, deadline, created_at, updated_at

rubrics                              -- 1:1 with project
  id, project_id, source_type (pasted|uploaded), confirmed_at (null until student approves parse), created_at

criteria                             -- stable across all attempts in a project
  id, rubric_id, name, description, required_evidence, display_order

attempts
  id, project_id, mode (paste|record), status (draft|transcribed|evidence_mapped|questioned|defended|completed),
  transcript, transcript_source (paste|asr), audio_duration_seconds, consent_at (set when mode=record),
  created_at, completed_at

evidence_verdicts                    -- one row per (attempt, criterion, stage)
  id, attempt_id, criterion_id, stage (initial|defense),
  verdict (supported|partial|unsupported), coverage_score (0 | 0.5 | 1),
  cited_span, verifier_agreed (null if Verifier didn't run — only runs on verdict=supported),
  verifier_note, student_overridden (bool), student_override_verdict, created_at

questions
  id, attempt_id, target_criterion_id, question_text, created_at

defense_answers
  id, question_id, answer_text, created_at
  -- its resulting judgment is the evidence_verdicts row with stage='defense',
  -- same attempt_id + criterion_id as the question — no extra FK needed

source_documents                     -- optional materials feeding QuestionGenerator / rubric upload
  id, project_id, blob_url, filename, uploaded_at
```

Three decisions worth carrying forward:

1. **`coverage_score` alongside `verdict`** — storing 0/0.5/1 numerically means the Progress
   endpoint is a plain `AVG(coverage_score) GROUP BY criterion_id ORDER BY created_at`, and
   "most recurring gap" is `MIN(avg)` — no app-side mapping logic.
2. **`stage: initial|defense`** on the same `evidence_verdicts` table — defense evaluation
   reuses EvidenceJudge, so it reuses the same row shape instead of a parallel table.
3. **Hard delete via cascade** — the source PDF commits to hard deletion (UU PDP 27/2022),
   so deleting an attempt cascades through `evidence_verdicts` → `questions` →
   `defense_answers`. No soft-delete flags anywhere.

Raw audio is never persisted anywhere in this schema — it is streamed to Groq, transcribed,
and discarded; only the resulting transcript text is stored, and the student can delete it
(cascading as above).

## 7. Error handling & reliability

| Failure | Handling |
|---|---|
| Zod schema validation fails on an LLM response | Retry once with a stricter prompt reminder. Second failure → surface "couldn't analyze this" in the UI, not a silent guess. |
| Citation span not found verbatim in transcript | Same retry-once pattern. Second failure → verdict forced to `unsupported` (safe default) with `citation_failed: true`, flagged for manual review, never fabricated as supported. |
| One criterion's EvidenceJudge call fails, others succeed | `Promise.allSettled`, not `Promise.all` — one bad criterion doesn't blank the whole evidence map; failed criterion shows an inline retry button. |
| ASR (Groq) down or times out | Attempt UI falls back to paste automatically. |
| Text-generation provider outage (RubricParser/EvidenceJudge/Verifier/QuestionGenerator) | AI Gateway's built-in failover to a backup model. |
| Cost/abuse control | Upstash Redis token bucket per user per AI-touching route. Over limit → 429 with a plain message, not a silent hang. |

## 8. Testing approach

- **Unit:** citation-span-matching function, coverage_score aggregation query, verdict-
  downgrade logic — pure, fixture-driven, no live model calls.
- **Integration:** each route handler against a test DB with mocked AI SDK responses —
  verify persistence and `attempts.status` transitions.
- **Golden-path e2e:** one full loop (rubric confirm → paste attempt → evidence map →
  question → defense → progress), mirroring the scope of the original prototype's browser-
  check suite referenced in the source PDF.

## 9. Explicitly out of scope for this design

Carried over from the source PDF's MVP table: body-language/facial scoring, gamified
streaks, generic speaking drills, institutional dashboards, any numeric confidence/ability
score shown to the student (Verifier's binary check in §3 is an internal grounding signal,
never surfaced as a percentage).

## 10. Open questions for implementation planning

- Rubric editing after initial parse (Table 4's "Rubric editor: add/edit/remove criteria")
  needs its own CRUD endpoints — not detailed above, deferred to the implementation plan.
- Export flow (consent/export/deletion requirement, source PDF §4.4) needs a concrete
  endpoint — noted here, not designed in detail.
- No git repository exists yet in this working directory; needs `git init` before this spec
  can be committed per the standard workflow.
