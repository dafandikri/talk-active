---
name: Talk-Active
description: Rubric-grounded rehearsal for Indonesian university students — every verdict points at the speaker's own words.
colors:
  canvas: "#f8f8f4"
  surface: "#fffef9"
  surface-sunken: "#eeefec"
  surface-inverse: "#24461c"
  border: "#d8dad7"
  text-primary: "#101312"
  text-secondary: "#3a3f3b"
  text-muted: "#676d68"
  text-on-inverse: "#fffef9"
  brand: "#2f5923"
  brand-hover: "#24461c"
  brand-wash: "#e5efdf"
  brand-contrast: "#fffef9"
  evidence: "#1b7ea6"
  evidence-strong: "#145f7e"
  evidence-wash: "#e0f2f8"
  evidence-border: "#86c9df"
  absence: "#898f8a"
  absence-wash: "#eeefec"
  absence-border: "#b4b8b4"
  accent-sun: "#f2b90c"
  accent-orange: "#bf6b04"
  danger: "#b3261e"
  caution: "#8a5a00"
typography:
  display:
    fontFamily: "Outfit, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.3125rem"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Outfit, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  voice:
    fontFamily: "Newsreader, ui-serif, Georgia, Times New Roman, serif"
    fontSize: "1.4375rem"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "normal"
  overline:
    fontFamily: "Outfit, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "0.12em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "20px"
  full: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-contrast}"
    rounded: "{rounded.full}"
    padding: "0.75rem 1.5rem"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
    textColor: "{colors.brand-contrast}"
  evidence-card:
    backgroundColor: "{colors.evidence-wash}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0.75rem 1rem"
  absence-note:
    backgroundColor: "{colors.absence-wash}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0.75rem 1rem"
  quoted-span:
    typography: "{typography.voice}"
    textColor: "{colors.text-primary}"
---

# Talk-Active design system

A student gives Talk-Active the rubric they will actually be scored against,
rehearses, and gets back — per criterion — the exact span of their own words
that supplies the evidence, or the explicit list of what is missing. Every
visual decision below serves that one loop.

**`src/tokens.css` is the source of truth.** The frontmatter above is a
mirror of it for tools that read DESIGN.md, and `test/design-system.test.mjs`
fails if the two disagree. Change the CSS, not this file.

## Colors

The palette has one rule that outranks taste: **blue is reserved.** The
`evidence-*` tokens mean "this claim is backed by a span the student actually
said." Blue never appears as decoration, and `design-system.test.mjs` fails
any component selector that reaches for it outside an evidence context. When
a surface needs a cool accent for non-evidence reasons it uses `accent-sky`,
which is deliberately the same hue — the constraint is on meaning, not on
wavelength, and a reader who learns "blue = cited" must never be taught
otherwise.

**Absence is grey, not red.** `--absence` marks a criterion no cue matched.
That is not a failing mark; it is the next thing to rehearse. Red here would
assert the grade this product explicitly does not give (INV-6).

Green is the brand and the structure. Warm accents — sun and orange — carry
attention and in-progress state.

## Typography

Three roles, and the third one is the interesting one.

- **`--font-ui` / `--font-heading` (Outfit)** — the interface. One family
  across both roles, separated by weight and size rather than by face.
- **`--font-voice` (Newsreader)** — reserved for the student's own quoted
  words. A cited span is rendered as a blockquote in a serif that appears
  nowhere else, so a quotation is recognisable as a quotation before it is
  read.

The voice face is a signal, not a flourish. An earlier stylesheet sprayed a
serif across stat numbers, avatars, and icon circles, which destroyed exactly
that signal; the test suite now guards the slot.

Type sizes come from a fixed scale (`--step-0` … `--step-6`) where no two
steps sit closer than 20% apart, so a size difference always reads as
deliberate.

## Spacing & layout

A 4px-based scale (`--space-1` … `--space-9`). Radii are small and
consistent; the pill (`--radius-full`) is reserved for actions and status
chips.

## Motion

`--duration-fast` 120ms, `--duration-base` 200ms, `--ease`
`cubic-bezier(0.2, 0, 0.2, 1)`. **Nothing animates a property that forces
layout** — transitions use `transform` and `opacity` only, enforced by test.
Reduced motion is respected.

## Anti-patterns

- Never use an `evidence-*` token outside an evidence context.
- Never render absence in red.
- Never present a number as a rating of the speaker. A figure may describe
  one rehearsal, and only beside its own weighting and what it could not
  measure (INV-6).
- Never load a font, script, or image from another origin. The CSP is
  `default-src 'self'`; everything ships same-origin.
- A coloured left border in this codebase is a **semantic channel**, not
  decoration — it distinguishes cited evidence from an evidence gap. Adding
  one for looks is the anti-pattern; the existing ones are waived per-line
  in `apps/web/app/shell.css` with their reasoning.
