# Talk-Active — design system

One source of truth for four surfaces: the web app, the booth display, printed
material, and what the team wears on 14 August.

Source of truth is `src/tokens.css`. This document explains the reasoning; the
tokens are the implementation; `test/design-system.test.mjs` is the enforcement.
When those three disagree, the test wins, then the tokens, then this file.

---

## 1. What this system is about

Talk-Active does one thing nothing else in the category does: **it shows you the
sentence you actually said, and tells you which criterion it satisfies.** Not a
score. Not a vibe. A quote, with a name attached.

Every decision below exists to make that one thing visible. That is the test for
any future addition: does it make the citation easier to find, or does it
compete with it?

Three rules follow, and they are the whole system:

**Evidence is the largest thing on screen.** The quoted span outranks the page
title in the type scale. Not by convention — `--step-evidence` is literally
defined larger than `--step-4`, and a test asserts it. Before this system, the
quote rendered at 9px underneath a percentage and a progress bar: the single
most important element on the review screen was the smallest text on it.

**One colour means evidence and nothing else.** Indigo carries structure.
Amethyst appears only where the product is pointing at the user's own words.
Spend it on a button and it stops meaning anything.

**Nothing is graded.** INV-2 forbids claiming an ability score and INV-4
requires the limits to stay visible. So the palette contains no green at all,
and a criterion is either *evidence found* or *no cue matched*. Neither reads as
a mark out of ten, which is what makes the disclaimer on the review screen true
rather than defensive.

---

## 2. Colour

### Why purple, and why two of them

Purple carries creativity, wisdom, and vision, and it is the one hue no other
team at a student hackathon commits to properly. `#4A32C8` is already ours: it
is `ristekpurple` from the submitted proposal, so a judge who read the document
meets the same colour at the booth. Continuity is free credibility.

But one purple cannot carry both "this is our brand" and "this is your
evidence." So the system runs two ramps, deliberately separated in hue:

| | Hue | Job |
|---|---:|---|
| **Indigo** | 250° | Structure. Navigation, headers, primary actions, the booth ground. |
| **Amethyst** | 278° | Evidence. Quoted spans, matched cues, the citation rule. Nothing else. |

**28° of separation** is the design decision, and it is enforced. Two purples
21° apart read as "the same colour, slightly off" under exhibition lighting, and
the reserved-hue idea silently dies. Amethyst is also more saturated than indigo
at every step, so it advances while indigo recedes.

### Screen values

| Role | Token | Hex | CMYK (computed) |
|---|---|---|---|
| Brand | `--indigo-500` | `#4A32C8` | 63 / 75 / 0 / 22 |
| Deep ground | `--indigo-900` | `#14093F` | 68 / 86 / 0 / 75 |
| Brand wash | `--indigo-100` | `#ECE8FB` | 6 / 8 / 0 / 2 |
| **Evidence** | `--amethyst-500` | `#9C38D6` | 27 / 74 / 0 / 16 |
| Evidence strong | `--amethyst-700` | `#631D8C` | 29 / 79 / 0 / 45 |
| Evidence wash | `--amethyst-100` | `#F8EBFF` | 3 / 8 / 0 / 0 |
| Ink | `--slate-900` | `#16141F` | 29 / 35 / 0 / 88 |
| Muted | `--slate-500` | `#6B6680` | 16 / 20 / 0 / 50 |

The CMYK figures are arithmetic conversions, not measured ink. **Vivid RGB
purples are outside CMYK gamut and will print duller and greyer than the screen
suggests** — this is a property of the process, not a mistake to fix. Before
anything goes to a printer, get a physical proof. If you need a spot colour,
take the hex to the print shop's Pantone book and match by eye; do not trust a
Pantone number derived from arithmetic, including any number produced by an
assistant, this one included.

### Accessibility

Every foreground/background pair the product actually uses is verified in
`design-system.test.mjs` against WCAG AA (4.5:1 for text, 3:1 for UI), computed
from the shipped tokens rather than from numbers typed into a comment. The
citation pair is checked hardest: it is the one element that must never be
marginal.

### Semantic tokens

Components never name a colour. They name a role:

| Token | Means |
|---|---|
| `--brand`, `--brand-hover`, `--brand-wash` | structure and primary action |
| `--evidence`, `--evidence-strong`, `--evidence-wash`, `--evidence-border` | **reserved: quoted user speech only** |
| `--absence`, `--absence-wash` | no cue matched — neutral, never red |
| `--text-primary` / `--secondary` / `--muted` | copy hierarchy |
| `--canvas`, `--surface`, `--surface-sunken`, `--surface-inverse` | grounds |
| `--danger`, `--caution` | **system** state only: failed analysis (INV-7), degraded gateway (INV-4) |

`--danger` on a criterion result is a design-system violation and the test
treats it as one. Red on a delete button is fine — that is an action, not a
verdict.

---

## 3. Typography

### Two typefaces, each with a job

`--font-ui` — the platform sans. **This is the application speaking.**

`--font-voice` — Georgia. **This is the user speaking.** Applied only to quoted
transcript spans and the judge's question. When you see a serif in Talk-Active,
those are somebody's actual words.

That split is a semantic signal, not decoration, and the test enforces it. The
previous stylesheet sprayed Georgia across stat numbers, avatar circles and icon
badges, which destroyed the signal entirely.

Both are platform fonts on purpose. The old stylesheet asked for `Inter` with no
`@font-face`, no font file in the repo, and a CSP (`style-src 'self'`) that
blocks Google Fonts. **It never loaded once.** The app rendered in whatever the
OS supplied, so it looked different on a developer's Mac than it would on the
booth laptop, and nobody knew. Naming a typeface you do not ship is INV-2
applied to type, and there is now a test that catches it.

### Scale

Seven steps, ratio 1.25, anchored at 12px. No two steps are closer than 20%, so
a wrong choice is visible rather than merely slightly off.

| Token | px | Use |
|---|---:|---|
| `--step-0` | 12 | overline, meta, badge |
| `--step-1` | 15 | body |
| `--step-2` | 19 | card title |
| `--step-3` | 23 | section head |
| `--step-4` | 29 | page title |
| `--step-5` | 37 | hero |
| `--step-6` | 46 | booth only |
| **`--step-evidence`** | **29 → 37** | **the quoted span** |

`--step-evidence` outranks `--step-4`. That is how "evidence is the hero" stays
true after four days of sleep-deprived edits.

The scale replaced 24 distinct pixel sizes ranging from 8px to 40px, several
within one pixel of each other. Everything formerly at 8–10px is now at least
12px, which is also the minimum that survives a booth screen at two metres.

---

## 4. Space, shape, depth

**Spacing** is a 4px scale, `--space-1` (4px) through `--space-9` (96px),
replacing 93 distinct raw pixel values.

**Radius**: `--radius-sm` 8, `--radius-md` 12, `--radius-lg` 20, `--radius-full`.

**Elevation**: three shadows. A fourth would be a decision nobody could defend.

---

## 5. The mark

A circle with one corner squared off — a speech bubble's tail, reduced until
only the asymmetry survives. A voice, given a shape.

It has to work at 16px in a browser tab, embroidered on a shirt pocket, and two
metres wide on a booth banner. That rules out gradients, hairlines, and interior
detail. One shape, one colour, one asymmetric corner.

- On light: indigo mark, white glyph.
- On dark: white or amethyst mark, indigo glyph.
- Never on a busy photo. Never rotated. Never re-coloured outside these two.
- Clear space on all sides equals the corner radius. Nothing intrudes.

---

## 6. Components that carry the thesis

### The citation card

The single most important component in the product.

```
┌─────────────────────────────────────────────┐
│▌ PROBLEM CLARITY              evidence found │  ← criterion is a LABEL,
│▌                                             │    not a heading
│▌  "Students rehearse alone and get no        │  ← the hero: voice serif,
│▌   feedback on whether their answer          │    --step-evidence,
│▌   actually met the rubric"                  │    larger than the page title
│▌                                             │
│▌  your words, from this attempt              │  ← provenance, always present
└─────────────────────────────────────────────┘
   ▌ 4px amethyst rule · amethyst wash ground
```

When no cue matched:

```
┌─────────────────────────────────────────────┐
│▌ FEASIBILITY                 no cue matched  │
│▌                                             │
│▌  Nothing in this attempt matched the cues   │
│▌  for this criterion. Looked for: timeline,  │
│▌  cost, team capacity.                       │
└─────────────────────────────────────────────┘
   ▌ 4px neutral rule · plain surface
```

Rules:

- **One column, never two.** A quote sharing a row with another quote is a quote
  nobody reads.
- **No percentage.** A number out of 100 is an ability score we do not have and
  must not imply. "evidence found" is a checkable fact about the transcript.
- **Absence is neutral and specific.** Not red, not empty. It names the cues we
  looked for, so the user knows what to say next time. INV-3 cuts both ways: a
  verdict with no quote must show the missing cues instead.
- **`textContent` only, never `innerHTML`.** The transcript is user input
  (INV-5).

### Coverage

Small, and labelled as what it is. INV-4 says evidence coverage is not a
confidence or ability score — and a large ring is exactly how it starts looking
like one. It supports the evidence below it; it does not compete.

---

## 7. Booth

`<body data-surface="booth">` switches the whole theme. Same semantic token
names, different values, so no component needs to know where it is rendering.

Deep indigo ground `#140A24`. Amethyst glows against it rather than merely
sitting there, and that glow is what makes someone walk over from across a hall.
All booth contrast pairs are verified at AA in the test suite.

**The laptop a judge touches stays light.** Dark UIs wash out on unknown
projectors and under bright exhibition lighting, and light reads as a credible
work tool rather than a toy. Two targets, two right answers, one token set.

Legibility floor: nothing below `--step-2` (19px) on the booth display, and the
headline at `--step-6`. Test it at two metres on the actual venue screen, not on
a desk — this is a C3 acceptance criterion.

No looping animation behind a live demo. Motion next to a person talking steals
the attention the person needs.

---

## 8. Apparel

The shirt is worn during pitching and the exhibition, so it is on camera and in
every photo taken at the booth. Treat it as a surface, not swag.

**Garment:** deep indigo, matched to `--indigo-900` as closely as the supplier's
stock allows. Not black, not white. Rich jewel tones hold up on camera without
the harshness of black or the blowout of white under venue lighting, and an
indigo shirt puts the team inside the same palette as the product behind them.

**Print method:** screen print, one or two colours. On dark fabric a white
underbase is required or the ink goes dull — budget for it. Avoid gradients and
anything under 2pt: both die in the wash and in a photo.

**Front, left chest:** the mark plus the wordmark, small. Roughly 8 cm wide.

**Back:** this is the part worth getting right. Do not print a logo. Print the
product's own interaction — a quoted line in the voice serif with the amethyst
rule beneath it, exactly as the citation card renders it:

```
     "We tested this with fourteen
      students at Fasilkom UI"
     ─────────────────────────────
     evidence found
```

Someone standing behind you in a queue learns what the product does without
being pitched. The shirt demonstrates the idea instead of advertising it, which
is the same reason the review screen leads with a quote instead of a score.

Keep the quote true. Printing a fabricated quote on a shirt is INV-1 with a
laundry cycle.

---

## 9. Slides

Purple as accent, not as flood. Deep indigo ground on section breaks and the
title; light ground for content, because a judge reading dense text on a dark
projector is a judge who stops reading.

Amethyst appears on a slide only when quoting something real — a user's words, a
rubric criterion, a judge's question. Same rule as the product. If the deck uses
amethyst decoratively, the shirt and the booth stop meaning anything.

One idea per slide. Type from the same scale.

---

## 10. What the tests enforce

`test/design-system.test.mjs` runs inside `pnpm check`. It fails the build on:

| Rule | Why |
|---|---|
| `font-size` outside the scale | 24 near-identical sizes accumulated exactly this way |
| Raw hex / `rgba()` in `styles.css` | ~40 one-off colours accumulated exactly this way |
| Primitive tokens in components | a component asking for `--indigo-500` knows too much |
| Raw px in padding / margin / gap | 93 distinct spacing values accumulated exactly this way |
| `--evidence-*` outside an evidence context | reserving the hue is the differentiator |
| `--font-voice` outside quoted speech | the serif is a signal; spread it and it dies |
| `--danger` / `--caution` on a verdict | green/red is the grammar of grading (INV-2, INV-4) |
| Any green in the palette | half of a traffic light; its absence is deliberate |
| A typeface named but not shipped | `Inter` was named for months and never loaded once |
| Any AA contrast failure | computed from shipped tokens, not from comments |
| Under 18° hue separation between the purples | below that they read as one colour |
| `tokens.css` not loaded before `styles.css` | the cascade resolves too late |

**Do not weaken a test to go green.** Change the decision here first, in a
commit, with the team (AGENTS.md, rule 3). A silently disabled test is a lost
point on the 14th.

---

## 11. Deliberately excluded

Per INV-6, scope stays bounded. Not in this system, and not to be added during
Innovation Week:

- Dark mode for the app. The booth theme is not dark mode; it is a different
  product surface with a different reader at a different distance.
- Any numeric ability score, per-criterion percentage, or letter grade.
- Green, and traffic-light verdict colouring.
- Icon set, illustration style, motion system, charting library.
- A custom or licensed typeface. Revisit after the hackathon, when there is time
  to self-host it properly and verify it loads under CSP.
