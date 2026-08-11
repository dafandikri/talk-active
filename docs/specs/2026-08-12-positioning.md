# Talk-Active — Positioning Correction

**Date:** 2026-08-12 · **Status:** urgent, affects the pitch and the deck
**Evidence:** [`../MENTORING/market-validation-research.md`](../MENTORING/market-validation-research.md)

Read this before writing a single deck slide. Three claims currently in the proposal would not
survive a judge with a laptop, and one of them is the differentiation claim the whole pitch
rests on.

---

## 1. The differentiation claim is falsifiable in two minutes

**Yoodli already ships user-supplied rubrics.** Its own support documentation describes Custom
Goals that "allow you to import your own rubric," with per-goal weighting.

It gets worse. On **11 August 2026 — the day before this was written** — Yoodli published a
buyer's guide arguing that "a fixed rubric produces feedback that does not match how your team
actually sells," and that good feedback must "reference specific moments in the conversation —
not just overall performance."

**That is our pitch, published by the incumbent, three days before finals.**

Any judge who searches "Yoodli custom rubric" during Q&A finds this. If we claim "no competitor
evaluates against a user-supplied rubric," we lose the round on that exchange — not because the
product is weak, but because we asserted something checkable and wrong. That is an INV-2
failure of exactly the kind the invariants exist to prevent.

### What actually survives, and it is still a real position

| Claim | Status |
|---|---|
| ~~"No tool evaluates against a rubric you supply"~~ | **Dead.** Retire it entirely. |
| "Rubric import is Enterprise-tier — unreachable for an Indonesian undergraduate" | **Holds** |
| "Theirs is the *organisation's* rubric; ours is the *evaluator's* published one" | **Holds** — different primary key |
| "A verdict is discarded in code unless it quotes you verbatim" | **Holds** — no competitor documents a refusal contract |
| "Built for Indonesian evaluation contexts and code-mixed speech" | **Holds** |

**The honest sentence:**

> Sales-coaching tools let an *organisation* load its own rubric on enterprise plans. We let a
> *student* load the evaluator's published rubric — the one that actually decides their
> outcome — and we refuse to show a verdict that cannot quote them.

Narrower than what is written today. It has the advantage of being true, and it survives the
follow-up question, which the current claim does not.

---

## 2. The competitor table omits the actual competitors

The proposal names Yoodli, Orai, Poised — all US, all delivery coaches. Searching in Indonesian
surfaces a market the proposal never mentions:

| Segment | Live Indonesian products |
|---|---|
| **Thesis defense** (persona: the defender) | Sidangin (Rp19,990/10 min), **DOSPEM** (Rp39k/2 weeks), SidangAI, Skripsita |
| **Scholarship interview** (persona: the applicant — *our revenue persona*) | Terang.ai, Latihan.io (Rp100k/interview), Teman Beasiswa, Cakrawala AI, prepinterview.ai |
| **Competition pitching** (persona: the competitor — *our beachhead*) | **Nobody** |

**DOSPEM is the serious one.** It ships a "grounding gate, contradiction check, and critical
weakness tracking" — architecturally the same claim we make, at the same price point, in
Indonesian, already live.

Also: **Poised was acquired by Deepgram in May 2024.** Listing it as a live independent
competitor dates the analysis and invites a correction from the floor.

### The strategic read

The two personas ranked #2 and #3 are **contested by local products we did not know existed**.
The persona ranked #1 — the competition pitcher — is **uncontested**.

That is not bad news. It means the beachhead choice was right for a reason the proposal never
articulated, and it should now be argued explicitly: *we lead with competition pitching because
it is the one high-stakes, published-rubric evaluation nobody serves.*

**Do not claim the defender or applicant segments are empty.** They are not, and DOSPEM at
Rp39k directly anchors against our Pro tier.

---

## 3. Numbers that break under scrutiny

| Claim | Problem | Replace with |
|---|---|---|
| "LPDP interview passes 6.7%" | **Not an interview rate.** 37,459 is Tahap 2 *registrations*; admin and scholastic stages precede the interview, and LPDP never publishes the substansi entry count. | **"~4,000 awards from ~78,000 applicants ≈ 5%"** (Kompas) — verified and unattackable |
| "81% report speaking anxiety" | **n = 27**, one private university's education faculty in Cianjur. Backup citation is n = 60. Most fragile claim in the document. | Lead with BPS instead (below); keep this only as illustrative, with the sample size stated |
| SAM ≈ 2.0M | ~60% high — derived as enrolment ÷ 4, while PDDikti reports ~1.26M graduates/year | Recompute from the ~1.26M figure |
| PDDikti enrolment, LPDP applicant growth | **Verify cleanly** | Keep as-is |

**INV-1 is in force.** Every one of these is an external fact that a judge can check. A number
we cannot source is a number they can discount — and discounting one number invites discounting
all of them.

---

## 4. The strongest replacement statistic

> **University graduates had a 5.38% unemployment rate in November 2025 — higher than
> junior-high leavers (3.76%) or primary-school leavers (2.29%).** — BPS

This is a far better opening than an n=27 anxiety survey, because it reframes the problem
correctly: **this is a selection failure, not a knowledge failure.** The most educated cohort
is the least employed. Something between competence and outcome is broken, and that something
is the interview, the defense, the pitch — the moment where a rubric decides.

That lands the mentor's note about connecting the problem to the solution, and it does it with
a government statistic nobody can wave away.

### The case study the mentor asked for

**PKM 2025**: 1,590 funded proposals from 7,171 students, with a **published assessment
guide**. Load that rubric live on stage beside the RISTEK guidebook — two real Indonesian
evaluation rubrics, both public, both parsed by the product in front of the judges.

---

## 5. Pricing: right number, wrong unit

Rp39,000/month sits below Spotify Indonesia standard (Rp59,900) and 3.3× under Yoodli Pro, so
the absolute figure is defensible.

The unit is not. Every local competitor prices **per event**: Sidangin per 10 minutes, DOSPEM
per two weeks, Latihan.io per interview. Indonesia is a ~0.7× ARPU market that favours short
commitment cycles, and the persona's own need lasts 4–8 weeks — a subscription they must
remember to cancel is friction priced into the decision.

**Keep Rp39,000. Sell it as a 30-day Event Pass.** Same revenue, matches how the need actually
arrives, and matches how every competitor in the market already sells.

Unused anchor worth deploying: **bimbel LPDP packages run Rp905k–1.2M for three mock
interviews.** Rp39,000 against Rp905,000 is a stronger frame than Rp39,000 against Spotify.

---

## 6. The unresolved grill item, now resolvable

Keep **the competitor** as the acquisition beachhead — it is the uncontested segment, and that
is now an evidence-backed reason rather than a preference.

Run an **earlier, separate motion into applicant channels**, because that is where Pro revenue
comes from and the segment is contested. The channels are concentrated and free:
**@indbeasiswa has 746K followers; @pejuangbeasiswalpdp has 152K.** One community partnership
reaches more of the revenue persona than the entire UI student-organisation network.

**Constraint found in research:** LPDP does not publish an interview rubric. Scope applicant v1
to genuinely published criteria — Chevening, Australia Awards, LPDP's essay requirements — and
do not imply we can parse a rubric that does not exist publicly. That is the same discipline as
the rubric-ingestion scope decision already locked in the grill findings.

---

## 7. What this changes in the pitch

| Beat | Change |
|---|---|
| **0:00–0:45 Problem** | Open with BPS 5.38%. Selection failure, not knowledge failure. Drop the n=27 survey from the headline. |
| **0:45–1:30 Insight** | Unchanged and now better supported — every evaluation publishes a rubric; nobody practises against it. |
| **3:00–5:00 Hero demo** | Add PKM 2025's assessment guide as a second live rubric alongside the RISTEK matrix. |
| **5:00–5:45 Defensibility** | **Rewrite.** Retire "nobody does this." Use the §1 honest sentence. Name Yoodli's Enterprise rubric import *before a judge does* — disclosed limits cost nothing, discovered ones cost the round (INV-4). |
| **5:45–6:30 Traction & ask** | Correct 6.7% → ~5%. Correct SAM. Position Pro as a 30-day Event Pass. |

### Add to the Q&A bank immediately

1. *"Yoodli already supports custom rubrics — what's different?"* → §1 sentence. **This will be asked.**
2. *"There are Indonesian thesis-defense AI tools already. How is this different from DOSPEM?"* → different segment, published rubric as primary key, verbatim refusal contract.
3. *"Where does 81% come from?"* → state the sample size honestly, pivot to BPS.
4. *"What stops a competitor adding rubric import next sprint?"* → the honest answer is execution speed plus Indonesian evaluation-context knowledge, not an unassailable moat. This was already locked in the grill findings; do not re-inflate it.

---

## 8. Why this is good news

Nothing here weakens the product. The build validated clean, the loop works, and the hero demo
is unaffected.

What changed is that we now know which sentences would have lost the round, three days before
we say them out loud, rather than during Q&A with a judge holding a laptop.

**Our preliminary win came from having the smallest judge spread in the field — no evaluator
had a reason to mark us down.** An unfalsifiable-sounding claim that turns out to be false is
exactly the kind of thing that produces one very low score from one thorough judge. Correcting
these protects the property that won the first round.
