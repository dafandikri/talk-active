# Landing page redesign — 18 August 2026

The public landing page at `/` is the first thing an Indonesian university student
sees, and it currently reads as plainer than the product deserves. This redesigns it
without touching the workspace.

**Scope:** `apps/web/components/production-shell.tsx`, `apps/web/app/shell.css`, the
`landing` message namespace, and one new artwork asset. Nothing in the practice,
review, or progress screens changes.

**Corrected 18 August, while planning.** Two factual errors in the first draft:

- The landing styles live in `apps/web/app/shell.css`, not `src/landing.css`.
  `src/landing.css` contains no `.production-shell` rules at all.
- **The loop's CSS was never removed.** `.production-shell__loop` survives in
  `shell.css` with its grid, its card borders, and an `--evidence-wash` treatment for
  the evidence step. Only the markup went. That strengthens the D8 argument: the
  section was not designed away, it was dropped and its styling left behind.
- The hero already sets `--step-6` over `--step-1`, so the scale jump this spec
  describes largely exists. What Editorial actually changes is the copy — shorter,
  harder, two lines — plus weight and tracking. Said plainly so nobody implements a
  ratio that is already there and reports it as the redesign.

## Status — 19 August 2026

Implemented. The loop is restored, the copy is casual, the hero carries the
editorial treatment, and the mascot has CSS depth. Gate green: 488 unit and
invariant tests, 75 browser checks.

**One decision exceeded this spec, with agreement.** D7 said the product stays
unchanged, and filling `--font-voice` changes quoted evidence everywhere, not just
the landing. It was widened deliberately rather than quietly, because the
alternative was worse: a landing-only voice face would show a quote treatment the
real product does not have, which is a visual overclaim of exactly the kind INV-2
exists to stop.

**What the design system taught, which this spec had wrong.** D3 argued the energy
should come from type because blue is reserved. Correct, but the spec then proposed
marking the hero's accent word — first in evidence blue, then in the voice face.
Both were rejected, the second by `design-system.test.mjs`, whose comment records
that an earlier stylesheet sprayed Georgia across stat numbers and icon circles
until the signal died. `--font-voice` had not been left empty by oversight; it had
been filled, abused, and deliberately neutralised. The accent word is colour only.

**Still owed:** the depth-rendered artwork. `.production-shell__kato` is sized for a
drop-in swap at 176×208; replacing `kato-macaw-reading.svg` with a real render needs
no code change. Until then the CSS shadow does the work, which is what D5 bought and
is not a placeholder.

**Not done, deliberately:** `/enter` still says `Anda`, so a visitor shifts register
in one click. D4 scoped the change to the `landing` namespace and this held to it.

---

## Decisions

Taken 18 August 2026, in the visual companion.

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| D1 | Hero composition | **Split** — copy leads, Kato answers, evidence card overlapping | Poster (Kato dominates); Anchor (full-height Kato) |
| D2 | Page structure | **Hero → loop → scenarios → CTA** | Scenarios only; evidence-walkthrough + limits |
| D3 | Visual treatment | **Editorial** — energy from typography | Composed; Playful |
| D4 | Copy register | **Casual `kamu`, landing only** | Casual everywhere; formal everywhere |
| D5 | 3D approach | **Pre-rendered art + CSS depth, 0 KB JS** | WebGL scene; no 3D |
| D6 | 3D subject | **Kato, rendered with depth** | Evidence card; both |
| D7 | Reach | **Bold landing, product unchanged** | Push the whole system younger |
| D8 | The `How it works` prohibition | **Change deliberately, record why** | Obey it; ask Farrel first |

### Why energy comes from type, not colour (D3)

`test/design-system.test.mjs` reserves blue for cited evidence — transcript spans,
matched cues, evidence-specific context. That reservation is the reason the review
screen reads as an instrument rather than a dashboard, and it holds across the whole
product.

The Playful direction spent green and orange as background fields. That is legal, and
it costs something anyway: a page saturated with brand colour has less contrast left
for the one colour that is supposed to *mean* something. Typography has no such
budget. A hard scale jump between headline and body is free, works at any viewport,
and cannot crowd the palette.

So on this page, blue appears on Kato and on the evidence card. Nowhere else.

### Why the register matters more than the artwork (D4)

Indonesian has a formal/casual split English does not. The landing currently says
*"Berlatih bersama Kato menghadapi rubrik yang benar-benar akan menilai Anda"* —
`Anda`, the register you use with a stranger or a superior.

No amount of 3D makes that sentence sound young. `kamu` does, immediately.

The product keeps `Anda`. A rubric verdict delivered casually reads as less
considered, and this product's credibility is that it sounds like it was thought
about.

**The boundary is the `landing` namespace, and only that one.** D4 said landing only,
and this spec holds to it rather than quietly widening scope.

That leaves a seam worth naming: `/enter` is the very next screen, and it still says
`Anda`. A visitor therefore shifts register in one click. This spec does not change
it, because nobody decided to — but it is the first thing to reconsider once the
landing copy exists and the two can be read together. Filed as a follow-up, not
smuggled in here.

---

## The `How it works` prohibition (D8)

`test/nielsen-heuristics.test.mjs` currently asserts:

```js
assert.doesNotMatch(LANDING, /How it works/u,
  'the landing page must not restore the removed explanatory section');
```

**That prohibition has no recorded rationale.** The commit it appears to reference,
`5a8cd66` *"Cut the landing page down to what a judge actually reads"*, explicitly
**kept** the section: *"What is left is hero, how it works, use cases, one centred
call to action."* The assertion arrived later inside `d79ed24`, an integration merge
covering interview coaching, consent, narration and routing, whose message never
mentions the landing page.

So this is a test asserting a decision nobody is on record as making. That is more
dangerous than a stale assertion, because it reads as considered and has been quietly
governing the page ever since.

**It is changed deliberately, not deleted, and not dodged.** Renaming the section to
slip past the regex would pass the test and defeat its intent, which AGENTS.md
forbids outright.

The replacement asserts the property `5a8cd66` actually cared about — that the loop
describes *what the user does*, not our internal stage names:

```js
// Replaces a prohibition that arrived inside an unrelated integration merge with
// no recorded reasoning. What 5a8cd66 cared about was that the loop speak in the
// user's terms rather than ours, so that is what is asserted now.
everyLocaleTranslates('landing', 'loopStep1', 'the loop must name what the user does');
assert.doesNotMatch(LANDING, /\b(stateless|deterministic|criterionEngines|semantic tier)\b/u,
  'the landing loop must not name internal stages');
```

---

## The page

### 1. Hero (D1, D3)

Two columns on desktop, stacked on mobile with copy first.

**Left:** a two-line headline at `--step-6` (2.875rem), one supporting sentence at
`--step-1` (0.9375rem), one call to action. That is a ratio of about 3.1, skipping
four defined steps — the jump *is* the design, and it is what separates this from an
assembled page. `--step-6` is the top of the existing scale in `src/tokens.css`; no
new step is added.

**Right:** Kato, rendered with depth, with the evidence card overlapping his lower
edge so the two read as one object. The card shows a criterion, a quoted span in
evidence blue, and one missing cue. It is illustrative, not live — and it must show
the same *shape* of output the product really returns, or the page overclaims by
implication (INV-2).

### 2. The loop (D2)

Four steps, horizontal on desktop, stacked on mobile:

> proyek → rubrik → percobaan → **bukti**

Each step is a short verb phrase in the user's own terms. The fourth carries slightly
more weight, because the evidence is the differentiator and the other three are
setup. No internal stage names, no engine names.

### 3. Scenarios

Kept from the current page — competition pitch, scholarship interview, thesis
defence, and an explicit "and more" that admits there are rooms we did not list.
Restyled to the editorial treatment; copy moves to `kamu`.

### 4. Call to action

One centred action. The same verb as the hero's button, because an action that
changes its name between two places on one page is two actions to a reader.

### Footer

Unchanged in structure. Copy moves to `kamu`.

---

## The artwork

**This asset does not exist yet, and cannot be produced by code alone.** The four
files in `src/assets/mascot/` are flat SVGs. A rendered-with-depth Kato is a
modelling and lighting job.

The implementation therefore builds the layout so the artwork is a **drop-in swap**:
a single `<img>` in a sized container, with `aspect-ratio` and explicit dimensions so
the page reserves its space and does not shift when it loads.

- **Ship first** with the existing `kato-macaw-reading.svg` given depth in CSS —
  layered shadow, a subtle gradient overlay, and a small parallax on scroll. This is
  honest work, not a placeholder: it is what D5 buys, and it looks intentional.
- **Swap later** to a real render (Blender or Spline, exported to WebP at 2×) by
  replacing the file. No layout change, no code change beyond the import.

Constraints on whatever lands there:

- **Same-origin.** The CSP is `default-src 'self'` with no external hosts. The file
  is bundled like every other asset. No CDN, no Spline runtime.
- **Under 200 KB**, matching the ceiling `design-system.test.mjs` already applies to
  the dashboard mascot. A booth on hotel Wi-Fi is the environment that matters.
- **`prefers-reduced-motion`** removes the parallax and every entrance animation.
  `src/styles.css` already carries that media query and the test asserts it.

---

## Copy

All new strings go in the `landing` namespace, both locales, per the extraction
completed in #36. The Indonesian is written in `kamu`; the English uses contractions
and second person.

Three sentences are load-bearing and must survive translation review:

1. **The headline** — two words carrying the page. It must name the *user's* problem,
   not the product's mechanism.
2. **The supporting line** — states what the tool returns and, by implication, what it
   does not. The Editorial mock used *"Bukan skor. Bukan penilaian gaya bicara."*
   Keeping a negation here is deliberate: it is the cheapest possible INV-2
   compliance, and it is also the most interesting thing on the page.
3. **The fourth loop step** — the word `bukti` is the product. It should not be
   softened into a synonym.

---

## Testing

- `test/nielsen-heuristics.test.mjs` — the D8 replacement above; H-10's landing
  reachability assertion is untouched.
- `test/i18n.test.mjs` — already enforces key parity, no blanks, and the
  byte-identical ceiling. New keys are covered automatically.
- `test/design-system.test.mjs` — unchanged and must stay green. It is the guard that
  the blue reservation survived.
- `e2e/production-ui/` — `golden-path` and `navigation-history` both enter through
  the landing page and assert its heading and CTA by name. Both need their selectors
  updated to the new Indonesian copy, exactly as the rest of #36 did.
- **New:** one browser check that the hero renders both columns at 390 px without
  horizontal overflow, and that the CTA is above the fold at 1280×720. The existing
  `expectNoHorizontalOverflow` helper covers the first.

---

## Out of scope

- Any change to the workspace, practice, review, or progress screens (D7).
- A WebGL runtime (D5). If interactive 3D is ever wanted, it is a separate spec with
  its own bundle-size and fallback argument.
- The register change anywhere behind the workspace frame (D4).
- New brand colours or type families. The system in `src/tokens.css` is sufficient;
  this page uses more of its existing range, not more range.

---

## Risks

| Risk | Mitigation |
|---|---|
| The editorial headline reads as hype and trips INV-2 by implication | The supporting line states the limit in the same breath. Reviewed against INV-2 before merge, and the `humanizer` skill runs on the copy. |
| The 3D render never arrives and the CSS-depth version ships forever | That is an acceptable outcome, not a failure. The CSS version is designed to look intentional on its own. |
| A large hero image hurts LCP at the booth | Explicit dimensions, `priority` on the Next image, and a size ceiling checked in the design-system test. |
| Casual register leaks into the product | The boundary is the namespace. `landing` and `entryGate` are casual; a reviewer checking any other namespace for `kamu` will find none. |
