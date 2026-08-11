# Talk-Active — RISTEK Hackathon 2026 finals pitch

Target: **6:15–6:45**, including the live demo. Hard stop: **7:00**. The operator—not the team—shares the submitted deck, so every switch below has an explicit spoken cue.

## Slide 1 — Cover · 0:00–0:20

Good afternoon. We are Team FAM, and this is Talk-Active.

Bring the evaluator’s rubric; leave with the exact sentence your answer still needs. Today we will prove that loop with the RISTEK finals rubric itself.

**Cue:** “First, the problem behind it.”

## Slide 2 — Problem · 0:20–0:55

University graduate unemployment was 5.38% in November 2025. That statistic is context, not causality—many forces shape employment.

Our bounded observation is simpler: in a pitch, defense, or interview, students can know the material and still fail to make the evaluator’s expected evidence explicit. The rubric exists, but practice is blind, and the hardest question arrives too late.

**Cue:** “The evaluator has already given us the answer key.”

## Slide 3 — Insight · 0:55–1:25

The evaluator has already given us the answer key: the published rubric.

Talk-Active connects that rubric to one student attempt, then refuses to show a supporting verdict unless it can quote the transcript—or explicitly list what evidence is still missing.

This is not a confidence score, body-language scoring, or a claim that a model understands the student. It is evidence coverage against the evaluator’s own criteria.

**Cue:** “Here is the full loop.”

## Slide 4 — Product loop · 1:25–1:50

The loop is project, rubric, attempt, evidence, defend, and saved progress.

The differentiating moment is the handoff between evidence and defense: the student sees the exact sentence supporting a criterion, then practises the hardest question generated from the weakest one.

**Cue:** “Let me show it with the rubric judging us today.”

## Slide 5 — Live product · 1:50–4:05

Please switch to the browser now.

### Operator path

1. Open the pinned production tab at `talk-active-id.vercel.app`.
2. Open the **Talk-Active — RISTEK Hackathon** project.
3. Show the six imported finals criteria.
4. Start practice and paste the rehearsed answer.
5. Analyse the attempt.
6. Point to one verbatim transcript span and its provenance label.
7. Point to one missing criterion and open the hardest likely judge question.
8. Paste the prepared defense answer and check it.
9. Open Progress and show that the session was saved.

### Spoken demo narration

This project keeps one evaluation context together. Here are the RISTEK finals criteria we imported from the published scoring matrix.

I will rehearse one answer. Talk-Active maps explicit evidence against each criterion. This card can point to my exact words. This one cannot, so it names what is still implicit rather than inventing credit.

The weakest criterion becomes the next judge question. I answer it once, see what became explicit, and save the result for the next attempt.

Please return to the deck.

### Recovery line if semantic analysis does not return

The network-assisted mapping did not answer inside our live-demo budget, so the product has switched visibly to deterministic cue matching. The loop still completes, and no unsupported verdict is hidden.

## Slide 6 — Proof · 4:05–4:35

That is the core proof. A supporting verdict must point to the student’s own words.

If a model proposes a quote that our server cannot find in the transcript, we discard that result and fall back visibly for that criterion. No quote means no supporting verdict. The weakest missing evidence becomes the judge question you practise next.

**Cue:** “Under the interface, the architecture protects that promise.”

## Slide 7 — Technical architecture · 4:35–5:15

The shipped stack is semantic HTML, CSS, native JavaScript modules, and Node on Vercel.

The browser sends text and rubric criteria to a Vercel Function; the AI Gateway key never reaches the client. A three-provider chain proposes evidence, then server code validates every span against the transcript. Invalid rows fall back visibly.

If the network is absent, the pure deterministic analyzer runs on the device and returns the same result shape, so the judge path still completes. Raw audio is not persisted; production expansion requires explicit consent, expiry, and deletion.

**Cue:** “That architecture also defines what is genuinely different.”

## Slide 8 — Differentiation · 5:15–5:50

We do not claim that custom rubrics are unique. Yoodli already lets enterprise organisations import their own rubric.

Our position is narrower and testable: the primary input is the evaluator’s published rubric, the user is the student, and we enforce a refusal contract—a supporting verdict disappears if it cannot quote the transcript.

Competition pitching is our beachhead. Indonesian thesis-defense and scholarship tools already exist, and we say that before a judge has to correct us.

**Cue:** “The same discipline applies to reliability and cost.”

## Slide 9 — Production reality · 5:50–6:15

The submission passes more than 150 automated tests, 18 real-browser checks, and a 16-stage demo gate with zero console errors.

AI spend is capped at five dollars with no auto-refresh and alerts at 50, 75, and 100 percent. Based on the actual primary model and prompt size, one semantic analysis is estimated at 0.27 to 0.6 cents; repeated demo inputs come from cache at zero additional model cost.

If the cap or network fails, the deterministic path remains.

**Cue:** “What is built today—and what comes next—is equally explicit.”

## Slide 10 — Boundary and roadmap · 6:15–6:35

Today we prove one bounded product: public-rubric projects, pasted or dictated attempts, traceable evidence, visible fallback, and saved progress.

Next, we run a ten-student outcome pilot, measure rubric-import accuracy, add consent and deletion controls, and earn institutional partnerships.

Give us one criterion. We will show the sentence—or refuse the verdict.

Thank you.

**Hard stop. Do not add an improvised closing.**

## Rehearsal evidence log

Record three consecutive full runs here. Only mark the pitch criterion verified after all three land between 6:15 and 6:45.

| Run | Date/time | Presenter | Duration | Demo mode | Missed cue or recovery | Witness |
|---|---|---|---:|---|---|---|
| 1 |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |

## Sources

- Problem context: [BPS November 2025 labour-force release](https://www.bps.go.id/en/pressrelease/2026/02/05/2547/november-2025--unemployment-rate-was-4-74-percent-and-the-average-wage-of-employees-was-3-33-million-rupiah-.html); education breakdown is in the release materials.
- Competitive boundary: [Yoodli — Creating Custom Goals](https://support.yoodli.ai/en/articles/11556965-creating-custom-goals) and [`docs/MENTORING/market-validation-research.md`](../MENTORING/market-validation-research.md).
- Product, test, privacy, and cost claims: repository source and automated gates as of 12 August 2026; see [`src/semantic.mjs`](../../src/semantic.mjs), [`api/analyze.mjs`](../../api/analyze.mjs), and [`scripts/demo-gate.mjs`](../../scripts/demo-gate.mjs).
