# Innovation Week Sprint — Talk-Active

**Owner:** Erdafa Andikri (lead developer) · **Team:** FAM (5) · **Status:** active
**Window:** 10–13 August 2026 build · 14 August exhibition + pitching
**Standing:** 2nd of the field in the preliminary round, 91.64 (91.90 / 91.73 / 91.30)

---

## 1. Situation

We won the preliminary round on **consistency, not peak score**. Our judge spread was 0.60,
the smallest in the field. Six teams beat our best single score at least once; five finished
below us. The floor ranks you.

That property came from a written artifact. **It does not transfer automatically to a live
demo.** The finals score a different thing:

| Final Presentation | pts | Exhibition | pts |
|---|---:|---|---:|
| **Technical Execution** | **30** | **Interactive Demo & Prototype** | **30** |
| **Pitching & Q&A** | **20** | **Communication & Engagement** | **30** |
| Problem Identification | 15 | Booth & Visual Display | 20 |
| Solution Alignment | 15 | Product Impact & Innovation | 20 |
| Innovation & Uniqueness | 10 | | |
| Design & UX | 10 | | |

**60 of 200 points require software that runs live without breaking. 50 more require us to
talk well.** Concept quality — the thing we already proved — is worth 60 and is largely
banked.

### What we promised in the proposal, and therefore owe

The submitted proposal states plainly that current analysis is *deterministic cue matching,
not semantic understanding*, and that **replacing it is the Innovation Week objective**. A
judge who read our proposal will ask about exactly this. Shipping semantic evidence mapping
is not a stretch goal; it is the commitment we made in writing.

---

## 2. The one thing that wins

**Hero moment (target: minute 4 of the 7-minute pitch).**

> On stage, paste the **finals scoring matrix from this guidebook** into Talk-Active, run our
> own pitch transcript against it, and show the judges their own rubric grading us — with
> every verdict citing the exact sentence we said.

Why this wins:

- It is the product's thesis performed rather than described.
- It is unfalsifiable theatre in the best sense: the judges supply the rubric, so nothing is
  staged.
- It answers "Innovation & Uniqueness — avoids standard open-source clones with unique logic"
  in one gesture. No delivery coach can do this.
- We already did it once for the proposal (32% coverage, weakest = Business Strategy). We
  know it produces an honest, interesting result.

**Everything in this sprint either makes that moment work, makes it safe, or makes the rest
of the product worthy of it.**

---

## 3. Scope

### In (ranked by points defended)

1. **Semantic evidence mapping** with cited transcript spans, behind a flag, deterministic fallback intact.
2. **Rubric import** — paste a scoring matrix, AI structures it into criteria + evidence cues, user confirms.
3. **Demo resilience** — public access, kiosk reset, mobile, zero console errors, no external hangs.
4. **Interface polish** — the screens judges and visitors actually see.
5. **Pitch + Q&A** — 7-minute script, live demo choreography, drilled answers.
6. **Experimental multimodal rehearsal (lead-approved integration, 13 Aug)** — opt-in browser
   dictation plus on-device MediaPipe face/pose landmarks and Web Audio observations. Results
   keep rubric substance, vocal signals, and visual signals separately inspectable; raw frames
   and audio are not persisted. The manual transcript path remains the demo-safe fallback.

### Out — decided, not deferred by accident

Accounts and auth · cloud sync · stored audio/video · identity recognition · emotion,
personality, confidence, health, gaze, or hiring inference · candidate ranking · streaks or
gamification · institutional dashboards · payment.

> Adding scope during a four-day sprint is how demos break. INV-6 is in force. Any addition
> to this list requires the lead's sign-off and a note in this file.

---

## 4. Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| **AD-1** | Semantic analysis runs in a **Vercel Function** (`/api/analyze`), never in the browser. | The API key must never reach the client. Also lets us cache and rate-limit. |
| **AD-2** | Rubric criteria remain a **versioned typed contract** from import through evidence review. The deterministic analyzer receives a derived compatibility string only at its boundary. | Descriptions, multi-word evidence phrases, stable IDs, and source order must survive semantic judging without lossy prompt reconstruction. |
| **AD-3** | **Every AI call is wrapped**: `try semantic → catch deterministic`, with a visible mode badge. | INV-8. A dropped connection degrades the demo instead of ending it. |
| **AD-4** | The model **must return the transcript span** justifying each verdict; a verdict without a span is rejected server-side. | INV-3. This is the differentiator; it cannot be left to prompt politeness. |
| **AD-5** | Fully semantic responses are cached by a versioned hash of transcript, typed criteria, prompts, and configured models; duration-only delivery observations are recomputed. Deterministic fallbacks are not cached as semantic answers. | Cost, rate limits, and instant replay without stale results after a prompt, model, rubric-description, or evidence-phrase change. |
| **AD-6** | The client adds one pinned vision dependency, `@mediapipe/tasks-vision@1.0.1`; its WASM and model assets are vendored same-origin. | One reviewed dependency buys the visible camera feature while avoiding a CDN/model-download failure on stage. |
| **AD-7** | Semantic capability is exposed only when a model and an enforced paid-route boundary are configured. Every response names semantic or deterministic provenance. | A missing key, model, or rate-limit boundary must never spend unexpectedly or masquerade as semantic analysis. |
| **AD-8** | Multimodal rehearsal is optional and fail-open. MediaPipe/WASM/model assets are same-origin; browser speech recognition may use the browser vendor's speech service. | The stage path survives denied permissions, unsupported dictation, or failed landmark tracking without losing typed rubric analysis. |
| **AD-9** | Multimodal results remain raw, separately labelled observations with explicit missing-measurement coverage. They never change rubric verdicts and are never combined into a rehearsal, confidence, or ability score. | Landmarks and acoustic samples are supporting rehearsal context, not a defensible measure of student quality. |

### Data flow (target)

```
browser  ──POST /api/analyze──▶  Vercel Function
   │                                  │
   │                          hash → cache hit? ──▶ return
   │                                  │ miss
   │                            AI Gateway → LLM
   │                                  │
   │                       validate: every verdict has a span
   │                                  │ invalid or error or timeout
   │                                  ▼
   └──────────────  deterministic analyzeSpeech()  ◀── same shape
```

---

## 5. Tracks, tasks, owners

Owner names are placeholders for the five of us; the lead assigns at the Day 1 standup.
**Est** is in focused hours. **DoD** = definition of done — all of it, or the task is not done.

### Track A — AI core (defends Innovation 10, data-flow 10, Tech Exec 30)

| ID | Task | Est | DoD |
|---|---|---:|---|
| **A1** | `/api/analyze` Vercel Function skeleton + AI Gateway wired, key in env, returns hardcoded valid shape | 2h | `curl` returns the analyzer shape; no key in client bundle; `pnpm check` green |
| **A2** | Prompt + schema for semantic evidence mapping; model must emit `{criterionId, status, span, missing[]}` | 3h | Structured output validated server-side; a response missing a span is rejected and logged |
| **A3** | Server-side validator + deterministic fallback wrapper (AD-3, AD-4) | 2h | Unit test: malformed model output falls back and sets `mode:'deterministic'`; never throws to client |
| **A4** | Client integration behind `SEMANTIC_ANALYSIS` flag + visible mode badge | 2h | Toggling the flag swaps engines with no UI change; badge reads "semantic" or "offline" |
| **A5** | Response cache keyed by hash(transcript+rubric) | 1h | Second identical analysis returns in <100ms; verified in demo gate |
| **A6** | **Rubric import**: paste matrix → structured criteria → user confirms before save | 3h | Pasting the guidebook's finals matrix yields ≥5 criteria with sensible cues; user can edit before saving |

### Track B — Demo resilience (defends Tech Exec 30, Interactive Demo 30)

| ID | Task | Est | DoD |
|---|---|---:|---|
| **B1** | **Make the deployment publicly reachable** — remove Basic Auth for the exhibition build (or add a public read-only path) | 1h | A stranger on their own phone can open the URL and use it; no credentials |
| **B2** | QR code to the live URL, printed for the booth | 0.5h | Scanned successfully from three different phones |
| **B3** | **Kiosk reset** — one control returns the workspace to a clean demo state between visitors | 1.5h | Reset restores seed projects in <1s; covered by demo gate |
| **B4** | Empty / error / loading states for every view | 2h | No blank panel is reachable; slow API shows a spinner, not a freeze |
| **B5** | Mobile pass at 390px for the whole judge path (visitors use phones) | 2h | Demo gate runs the full path at 390px with zero overflow and zero console errors |
| **B6** | Extend `scripts/demo-gate.mjs` to cover semantic mode, fallback mode, and kiosk reset | 1.5h | Gate fails if fallback does not engage when the API is stubbed to error |

### Track C — Interface & booth (defends Design & UX 10, Booth & Visual 20)

| ID | Task | Est | DoD |
|---|---|---:|---|
| **C1** | Visual pass on the three demo screens: workspace, evidence review, judge room | 3h | Consistent spacing, type scale, and colour; reviewed on the actual demo screen |
| **C2** | Make the **evidence citation** visually unmissable — it is the differentiator | 1.5h | A visitor identifies "this quote is why" without being told |
| **C3** | Booth display: looping hero screen + one-line value proposition readable from 2m | 2h | Legible from 2m on the venue screen; no motion that distracts from the live demo |
| **C4** | Printed one-pager: problem, loop diagram, QR, team | 1.5h | A visitor who reads only this can explain what we do |

### Track D — Pitch & Q&A (defends Pitching 20, Communication 30)

| ID | Task | Est | DoD |
|---|---|---:|---|
| **D1** | 7-minute script with the hero moment at minute 4, timed to 6:30 | 3h | Three consecutive runs land 6:15–6:45 |
| **D2** | Demo choreography: exact clicks, pre-loaded state, recovery line if the API fails | 1.5h | Rehearsed once with the network physically off |
| **D3** | Q&A bank: every question a judge could ask, with a ≤30s answer | 2h | ≥20 questions; every mentor question from Days 1–4 added |
| **D4** | **Drill Q&A using Talk-Active itself** against the finals rubric | 1.5h | Every criterion reaches "defensible"; screenshot kept as evidence |
| **D5** | Deck: value prop, tech stack, architecture, core features, live demo slot | 2h | Matches the guidebook's required pitch content list exactly |

### Track E — Integration & ops (defends everything)

| ID | Task | Est | DoD |
|---|---|---:|---|
| **E1** | Branch protection habit: `pnpm check` green before every merge | — | Standing rule, not a task |
| **E2** | Nightly: run full gate, tag a known-good commit | 0.5h/day | A tagged commit exists each night that we could demo from |
| **E3** | Prepare the **offline demo laptop**: local server, seeded data, browser bookmarks | 1h | Full demo runs with wifi physically disabled |
| **E4** | Final submission package by 13 Aug 18.00 WIB | 1h | `pnpm finals` green; submitted before the official deadline, with a screenshot of the confirmation |

---

## 6. Day-by-day

Times follow the official Innovation Week timeline. **Mentoring is 19.00 daily and requires
minimum 4 of 5 members present** (⌊N/2⌋+1).

### Day 1 — Mon 10 Aug · alignment + proof of life
- `11.00` **Standup.** Assign owners. Read this spec together. Agree the hero moment.
- `13.00–16.00` **A1** (function + gateway), **B1** (public access), **C1** starts.
- Target by 18.00: **a real LLM call returns a valid analyzer shape.** Nothing else matters today.
- `19.00` **Mentoring 1** — show the working prototype, ask: *is the hero moment the right bet?*
- `21.00` Async check-in. Log every mentor question into the Q&A bank (**D3**).

### Day 2 — Tue 11 Aug · make it real
- `11.00` Standup.
- `13.00–16.00` **A2, A3** (semantic mapping + fallback), **A6** (rubric import), **C1/C2**.
- Target by 18.00: **semantic analysis works end-to-end with fallback proven.**
- `19.00` **Mentoring 2** — demo semantic mapping live. Ask about the pitch narrative.

### Day 3 — Wed 12 Aug · integrate and harden
- `11.00` Standup. **Scope freeze on new features.**
- `13.00–16.00` **A4, A5, B3, B4, B5, B6**; **D1** first draft; **C3, C4**.
- Target by 18.00: **full judge path green in both modes, on mobile.**
- `19.00` **Mentoring 3** — run the actual 7-minute pitch at the mentor. Ask for the hardest question they have.
- `21.00` **First full rehearsal on the demo laptop.**

### Day 4 — Thu 13 Aug · freeze, submit, rehearse
- `11.00` Standup. Triage: bugs only.
- `13.00–16.00` Bug fixes, **E3** offline laptop, **D2** choreography, **D4** self-drill.
- `17.00` **SUBMISSION TARGET.** Upload early enough to verify the file, links, and confirmation.
- `18.00` **OFFICIAL SUBMISSION DEADLINE + HARD FREEZE.** No presentation-content changes after this point; the technical-meeting penalty is −5 points. No merges after this except a demo-breaking bug fix with the lead's approval and a green gate.
- `19.00` **Mentoring 4** — final review.

### Day 5 — Fri 14 Aug · execute
- `06.30–07.30` Participant arrival. `07.30–09.00` exhibition preparation.
- `09.00–11.00` Innovation Forum and `09.00–12.00` exhibition visits run simultaneously. At least 3 of 5 members represent the team at the forum; the remaining 2 staff the booth.
- `13.00–13.25` Pitching briefing. `13.25–13.30` team preparation. Randomized team slots run `13.30–15.10`; each slot is **2 min preparation + 7 min presentation + 3 min Q&A**, with a hard stop.
- `15.10–15.30` Judges' deliberation. `15.30–16.00` awarding and closing ceremony.
- Bring: demo laptop, charger, HDMI + USB-C adapters, phone hotspot, printed one-pager, QR.

---

## 7. Coordination

**Do not adopt a new tool this week.** Learning a tracker costs more than it saves over four
days. Use what is already under the code:

| Channel | Purpose |
|---|---|
| **GitHub Issues** (one per task ID above) | The only source of truth for *state*. If it is not an issue, it is not being worked on. |
| **GitHub Projects board** — `Todo · Doing · Blocked · Done` | The only view of *flow*. One card per issue. |
| **This file** | The only source of truth for *plan*. Changes to scope are edited here, in a commit. |
| **WhatsApp** | Realtime only. Never the source of truth — decisions get restated in an issue. |
| **`pnpm check`** | The only definition of *done*, and the merge permission. |
| **`pnpm finals`** | Strict evidence gate for the official product, presentation, and exhibition rubric before submission. |

**Labels:** `demo-critical` · `blocker` · `p1` · `p2` · `nice-to-have` · `track:A`…`track:E`

**Rules**
1. One assignee per issue. Unassigned work is nobody's work.
2. **WIP limit 1 per person.** Finish before starting.
3. Anything blocked >30 min goes in the WhatsApp group immediately, then gets a `blocker` label.
4. Standup at 11.00 (the official Team Discussion slot): *yesterday / today / blocked* — three
   sentences each, 10 minutes total.
5. Merge small, merge often. No branch lives longer than a day.
6. **Never weaken a test to go green.** Fix the work, or change the invariant in `AGENTS.md`
   deliberately, with the team's agreement.

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| LLM API fails during the live pitch | Medium | **Fatal** | AD-3 fallback + A5 cache + D2 recovery line + E3 offline laptop | Demo owner |
| AI spend or provider traffic exceeds the demo boundary | Low | High | Paid routes require an attested production rate-limit boundary; model/prompt versions are explicit in cache keys; the Gateway key has a hard budget and expiry | Integration |
| Venue wifi drops | High | High | Run from localhost on the demo laptop; phone hotspot as backup; no external resources (gate-enforced) | Demo owner |
| Camera/microphone permission, browser dictation, or landmark loading fails | Medium | Medium | Multimodal capture is separately consented and optional; same-origin pinned assets avoid runtime CDN fetches; typed/manual transcript analysis remains available | Interface |
| On-device landmark tracking causes mobile jank or a long first load | Medium | Medium | Tracking is opt-in, sampled at a bounded rate, and excluded from rubric verdicts; rehearse on the actual demo phone/laptop and use transcript-only mode if performance is poor | Demo owner |
| Semantic mapping is not ready by Day 3 | Medium | Medium | It is behind a flag. Ship deterministic and say so honestly — that is what we did in the proposal and it scored 91.64 | Lead |
| Overrun on the 7-minute limit | Medium | High | Hard cut is enforced by the organisers. D1 times to 6:30 with 30s of slack | Pitch owner |
| Someone breaks `main` at 2am | Medium | High | `pnpm check` is the merge permission; E2 nightly known-good tag to fall back to | Integration |
| <4 members at a mentoring session | Low | High | Attendance is a scored requirement. Lead confirms the roster by 17.00 daily | Lead |
| Scope creep from mentor suggestions | High | Medium | Mentor ideas go to the Q&A bank or the post-hackathon roadmap, not into this sprint | Lead |

---

## 9. Pitch structure (7:00, target 6:30)

| Time | Beat | Owner |
|---|---|---|
| 0:00–0:45 | **The bounded problem.** University graduate unemployment is context, not causality. In a pitch, defense, or interview, students can know the material while leaving the evaluator's expected evidence implicit; the published rubric exists, but practice is blind to it. | |
| 0:45–1:30 | **The insight.** Every evaluation publishes its rubric. Nobody practises against it. Existing coaches are rubric-blind. | |
| 1:30–3:00 | **The product.** Walk the loop: project → rubric → attempt → cited evidence → hardest question → progress. | |
| 3:00–5:00 | **HERO: live demo.** Paste the finals scoring matrix. Analyse our own pitch. Show a verdict citing the exact sentence. | |
| 5:00–5:45 | **Why it is defensible.** Rubric is the primary key, not a prompt input. The Indonesian rubric archetype library compounds. | |
| 5:45–6:30 | **Traction, honesty, ask.** What works today, what is next, what we need. State the boundary before a judge finds it. | |

Then **3:00 Q&A** — every answer ≤30s, then stop talking.

---

## 10. Definition of done for the whole sprint

- [x] `pnpm check` green on the tagged submission commit
- [ ] `pnpm finals` green with evidence for all 10 scoring criteria and all technical-meeting requirements
- [x] Semantic mode works; fallback proven by stubbing the API to fail
- [x] Full judge path passes on desktop **and** at 390px, zero console errors
- [ ] A stranger can open the public URL on their phone and complete one session
- [x] Rubric import handles the guidebook's own finals matrix
- [ ] Pitch runs 6:15–6:45 three times consecutively
- [x] Q&A bank ≥20 questions, all mentor questions included
- [ ] Offline laptop runs the full demo with wifi disabled
- [ ] Submitted before 13 Aug 18.00 WIB, confirmation screenshotted
