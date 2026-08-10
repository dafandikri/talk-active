# Prompt for Claude Design

Paste everything below the line into [claude.ai/design](https://claude.ai/design).
It is self-contained: it carries the product thesis, the exact tokens, and the
constraints, so a fresh session produces work that drops into this repo without
translation.

Attach `docs/design/preview/app.png` and `docs/design/preview/booth.png` if you
can — they show the system as it currently renders.

**Keep the constraints section intact.** It is doing most of the work. The parts
that read like arbitrary restrictions ("no green", "no percentage") are load
bearing: each one is an invariant we are scored against, and dropping it
produces confident, attractive, wrong work.

---

You are designing Talk-Active, and I need you to work from a thesis rather than
from taste.

## What it is

Talk-Active is a rehearsal workspace for Indonesian university students
preparing for judged presentations — thesis defences, competition pitches,
scholarship interviews. The student pastes in the *actual rubric the judge will
use*, rehearses an answer, and gets back, per criterion, either **the exact
sentence from their own transcript that satisfies it**, or **the list of cues
that were missing**.

It is built by team FAM for the RISTEK Hackathon 2026 at Universitas Indonesia.
We placed 2nd in the preliminary round. The finals are a live demo plus a booth
exhibition, judged on Technical Execution (30), Interactive Demo (30),
Communication (30), Booth & Visual Display (20), Design & UX (10).

## The one idea everything serves

Every competitor gives you a score. **We give you the quote.**

Nothing else about the product matters as much as that. So the design has one
job: make the citation the thing you cannot miss. When you are unsure about a
decision, ask which option makes the quoted sentence easier to find, and pick
that one.

Three rules follow, and they are non-negotiable:

**1. Evidence is the largest thing on screen.** The quoted transcript span
outranks the page title. Not "is prominent" — literally larger in the type
scale. Before this system, the quote rendered at 9px underneath a percentage
and a progress bar, which is how a differentiator becomes a slogan.

**2. One colour means evidence and nothing else.** Indigo carries structure.
Amethyst appears *only* where the product points at the user's own words. Put
amethyst on a primary button and it stops meaning anything, and rule 1 dies
with it.

**3. Nothing is graded.** We do deterministic cue matching. We cannot measure
how good a speaker is, so we must never imply that we can. A criterion is
either *evidence found* or *no cue matched*. There is no percentage, no letter,
no ring filling up, no green tick, no red cross.

## Voice

Plain, specific, calm. Indonesian university students who are nervous about a
real evaluation. Never gamified, never congratulatory, never scolding. "No cue
matched" — not "You failed this criterion" and not "Almost there!"

A criterion with no evidence is the next thing to rehearse, not a mark against
the person.

## Tokens — use these exactly

Colour is expressed only through role tokens. Never a raw hex.

```
STRUCTURE (indigo, hue 250°)
  --brand              #4A32C8   nav, primary action, headings
  --brand-hover        #3A26A8
  --brand-wash         #ECE8FB
  --brand-contrast     #FFFFFF
  --surface-inverse    #14093F   dark hero panels, sidebar
  --inverse-raised     #2A1C8A   chips on a dark ground
  --inverse-accent     #9186EC   accents on a dark ground

EVIDENCE (amethyst, hue 278° — RESERVED)
  --evidence           #9C38D6   the citation rule and marker
  --evidence-strong    #631D8C   citation labels and text
  --evidence-wash      #F8EBFF   the citation card ground
  --evidence-border    #CE8AF5

ABSENCE (neutral — never red)
  --absence            #8F8AA3
  --absence-wash       #EFEEF4

TEXT / SURFACE
  --text-primary       #16141F
  --text-secondary     #3E3A50
  --text-muted         #6B6680
  --canvas             #F8F8FB
  --surface            #FFFFFF
  --surface-sunken     #EFEEF4
  --border             #DCDAE6

SYSTEM STATE — failed analysis or degraded service ONLY, never a verdict
  --danger             #B3261E
  --caution            #8A5A00
```

The 28° hue gap between indigo and amethyst is deliberate and is enforced by a
test. Two purples closer than that read as one colour under exhibition lighting
and the whole reserved-hue idea collapses. Do not narrow it.

**Type scale** — 7 steps, ratio 1.25. Use only these:

```
--step-0  12px   overline, meta, badge
--step-1  15px   body
--step-2  19px   card title
--step-3  23px   section head
--step-4  29px   page title
--step-5  37px   hero
--step-6  46px   booth display only
--step-evidence  29 → 37px   THE QUOTED SPAN (outranks the page title)
```

**Two typefaces, each with a job:**

- `--font-ui` — platform sans stack. *The application speaking.*
- `--font-voice` — Georgia. **The user speaking.** Applied only to quoted
  transcript spans and the judge's question.

That split is a semantic signal. When you see a serif in Talk-Active, those are
somebody's actual words. Do not use the serif for stat numbers, headings, or
decoration — it destroys the signal.

Do not introduce a webfont. Our CSP is `style-src 'self'` and we ship no font
files, so anything else silently fails to load.

**Spacing** — 4px scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. Nothing between.
**Radius** — 8, 12, 20, full. **Elevation** — three shadows, no more.

## The component that matters

```
┌──────────────────────────────────────────────┐
│▌ PROBLEM CLARITY               evidence found │
│▌                                              │
│▌  "Students rehearse alone and get no         │
│▌   feedback on whether their answer           │
│▌   actually met the rubric"                   │
│▌                                              │
│▌  your words, from this attempt               │
└──────────────────────────────────────────────┘
  ▌ 4px --evidence rule · --evidence-wash ground
    quote in --font-voice at --step-evidence
```

```
┌──────────────────────────────────────────────┐
│▌ FEASIBILITY                  no cue matched  │
│▌                                              │
│▌  Nothing in this attempt matched the cues    │
│▌  for this criterion. Looked for: timeline,   │
│▌  cost, team capacity.                        │
└──────────────────────────────────────────────┘
  ▌ 4px --absence-border rule · plain --surface
```

The criterion name is a small uppercase **label on** the quote, not a heading
above it. One card per row, never two side by side — a quote sharing a row with
another quote is a quote nobody reads.

## What I want from you

1. **The citation card**, both states, refined. This is the priority; if you do
   nothing else, do this.
2. **The review screen** it lives on. Coverage is shown small and labelled "not
   a confidence or ability score" — it supports the evidence, it must not
   compete with it.
3. **The judge room** — a judge-style follow-up question, an answer box, and
   feedback tied back to the same rubric criterion.
4. **The booth display** — a 16:9 dark screen (`#140A24` ground) that loops the
   product's value in one line plus one live citation, readable at 2 metres in a
   bright hall. Nothing below 19px. No motion that competes with a person
   speaking in front of it.
5. **A t-shirt back print** — the citation card, reduced to its essentials, in
   one or two screen-print colours on a deep indigo garment. It should teach a
   stranger standing behind us in a queue what the product does.

## Hard constraints — work will be rejected if it breaks these

- **No green anywhere.** Green is half a traffic light, and traffic lights are
  the grammar of grading. Its absence is what stops a verdict reading as a mark.
- **No percentage, ring, bar, letter grade, or star rating on a criterion.**
- **No red or amber on a verdict.** Red is allowed only on a destructive action
  or a genuine system failure.
- **Amethyst only on evidence.** Not on buttons, not on nav, not on decoration.
- **The serif only on quoted speech.**
- **Nothing smaller than 12px**, on any surface.
- **WCAG AA** on every text pair; the citation pair must be comfortably clear of
  the line, not marginal.
- **No gradients on text, no glassmorphism, no drop shadows on type, no emoji,
  no illustration.** This is an evaluation tool used by anxious people shortly
  before something that matters to them.
- **No claim the product cannot support.** No "AI-powered", no "understands your
  argument", no "confidence", no "guarantees". Describe what it does.

## What good looks like

A judge walks up to our booth, glances at the screen for three seconds, and
without anyone explaining anything, understands: *it found the sentence I said,
and it told me which criterion that sentence answers.*

If your design achieves that, everything else is negotiable. If it does not, no
amount of polish saves it.
