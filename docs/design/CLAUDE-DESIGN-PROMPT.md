# Talk-Active design brief

Use this brief when generating or reviewing product, booth, print, or apparel
work. Attach `docs/design/preview/app.png` and
`docs/design/preview/booth.png`; they render from the shipped token source.

## Product

Talk-Active is a rubric-grounded rehearsal workspace for Indonesian university
students. A student brings the evaluator's actual rubric, rehearses an attempt,
and sees either the exact sentence that supports each criterion or the exact
cues that were missing. They then answer one judge-style question grounded in
their weakest claim and save the session.

The loop is:

> project → rubric → attempt → cited evidence → hardest question → progress

It is not a landing page, generic public-speaking scorecard, confidence meter,
or gamified habit app.

## Thesis

Every competitor gives you a score. Talk-Active gives you the quote.

The cited transcript span is therefore the largest thing on the review screen.
It outranks the page title and every supporting metric. Blue identifies cited
evidence and nothing else. A criterion without evidence remains neutral and
lists the missing cues; it never appears as a red failure or green success.

## Identity: a bird that speaks

The mascot is a simplified full-body speaking bird in profile—face, wing,
chest, and long tail visible—inside a speech bubble. It is not a floating head,
assistant orb, emoji, or cartoon scorekeeper.

Use the captain-supplied `src/assets/LOGO.png` as the source; never redraw or
auto-vectorise it. Use `src/assets/LOGO-dashboard.png` in the workspace, where
only the outer canvas is transparent and the speech-bubble interior stays
white. The bird itself carries the supplied palette:

- sky blue `#1B7EA6` — wing and tail;
- deep leaf `#2F5923` and bright leaf `#3A731F` — crown and back;
- sunlight `#F2B90C` — chest and attention;
- warm orange `#BF6B04` — open beak and small warm details;
- warm white `#FFFEF9` — face patch;
- near black `#101312` — speech-bubble ground and text.

The bird may welcome, explain an empty state, or invite the next answer. It
never congratulates a pass, scolds a failure, or claims to understand a person.

For large welcome and explanation surfaces, use
`src/assets/macaw-mascot-3d.webp`: the full-body bird on a deep-leaf field,
speaking from a dark bubble with one wing gesturing forward. Animate only a
slow greeting/breathing motion and stop it for `prefers-reduced-motion`. Keep the
supplied PNG artwork for navigation, identity, print, and small states.

The Talk-Active logo lockup always pairs that mark with the hyphenated
`Talk-Active` wordmark. Keep the wordmark primarily black or white; `Active`
may use one bird-colour accent appropriate to the surface.

## Colour roles

Use semantic roles, never raw values in components.

```text
--brand / --brand-hover / --brand-wash
  leaf green: shell, primary action, selection, setup

--evidence / --evidence-strong / --evidence-wash / --evidence-border
  sky blue: cited speech and matched cues only

--absence / --absence-wash / --absence-border
  neutral: no cue matched

--accent-sky
  non-verdict practice guidance

--accent-leaf
  setup and navigation only; never a result

--accent-sun
  attention, timing, current context

--accent-orange
  small warm detail; never a large field
```

Warm white remains the dominant application surface. Deep leaf green carries
the sidebar and hero surfaces. The booth switches to a near-black ground so the
bird palette stays legible from two metres.

Green must not colour a criterion verdict, evidence coverage number, defense
status, progress score, or session result. In those contexts it reads as
“passed,” which the product cannot claim.

## Typography

Use the shipped platform stacks only.

- `--font-ui`: application voice, used for controls and product copy.
- `--font-voice`: Georgia, used only for a person's quoted speech and the
  judge's question.

Use only the token scale: 12, 15, 19, 23, 29, 37, and 46px. The quoted-evidence
step ranges from 29 to 37px and must be able to outrank the 29px page title.

## Material

Do not use blurred card shadows. Depth comes from crisp outlined paper edges, a
heavier bottom border, one asymmetric speech-bubble corner, and thin sound-wave
contours on a dark hero surface. The public landing page and dashboard home may
use two-pixel black outlines with small, unblurred offset shadows in the bird
palette, like printed-poster registration. The canvas may carry a nearly
invisible paper grain.

No glassmorphism, decorative gradients, glow, fake depth across the interface,
or drop shadows on type. Dimensional rendering is reserved for the mascot.
Keep practice and evidence screens calmer than the expressive dashboard home.

Use a deliberate intensity ladder: landing 200%, dashboard home 60%, workflow
screens 30%. The landing may use large arrows, illustrated explanatory assets,
tilted cards, and 8–16px hard offsets. The dashboard keeps offsets to 4px.
Practice, review, judge, rubric, and progress use a compact logo cue, the same
pale-yellow header and deep-green actions as Home, warm-white cards, and black
outlines. They use no decorative shadows or route-specific colour stripes and
never decorate over cited evidence.

## Priority components

1. Citation card, both evidence-found and no-cue states.
2. Review screen, with the citation visibly dominant.
3. Judge room, tying the follow-up and response back to one rubric criterion.
4. Mobile application path at 390px.
5. 16:9 booth display, readable from two metres.
6. T-shirt: sky-blue `#1B7EA6` fabric with the dedicated one-ink warm-white
   bird/chat-bubble lockup on the front; the product promise and five-step
   rehearsal loop on the back. Use `src/assets/macaw-mark-white.svg`.

### Citation card

```text
┌──────────────────────────────────────────────┐
│▌ PROBLEM CLARITY              evidence found │
│▌                                              │
│▌ “Students rehearse alone and get no         │
│▌  feedback on whether their answer met       │
│▌  the rubric.”                                │
│▌                                              │
│▌ your words · this attempt                    │
└──────────────────────────────────────────────┘
```

One quote per row. Criterion name as a compact label. Provenance always present.
The no-cue state lists what was sought and uses no blue, green, red, X, or tick.

## Product behaviour

- Fast and dependency-free on the client.
- Mobile-first, with no horizontal overflow at 390px.
- Bite-sized: one clear action per stage.
- Personal: recognizable bird identity and direct language.
- Serious: no streaks, confetti, grades, or toy-like score feedback.
- Accessible: WCAG AA for every shipped text pair.
- Honest: no “AI-powered,” “understands your argument,” “confidence,” or
  “guarantees” language unless the build demonstrably supports it.

## Acceptance test

A judge should understand within three seconds that Talk-Active found a sentence
the student said and mapped it to a real criterion. If that relationship is not
the first thing they see, the design is not finished.
