# Talk-Active — design system

One source of truth for the product, booth display, printed material, and team
apparel. The implementation lives in `src/tokens.css`; this document records the
reasoning; `test/design-system.test.mjs` prevents drift.

When these disagree, the tests win, then the tokens, then this document.

---

## 1. The product thesis

Talk-Active shows a student the sentence they actually said and the rubric
criterion it supports. It does not grade confidence, personality, or ability.

That creates three permanent rules:

1. **Evidence is the largest thing on the review screen.** The cited quote uses
   `--step-evidence`, which is larger than the page-title step.
2. **Blue means cited evidence.** It is reserved for transcript spans, matched
   cues, and evidence-specific supporting context.
3. **Absence is neutral.** “No cue matched” names what was missing; it is not a
   red failure state or a green success state.

The visual system serves those rules. It is not a palette laid on top of a
dashboard.

---

## 2. Personality: a bird that speaks

The mascot is a full-body speaking bird, not a floating head, face sticker, or
generic assistant orb. It stands in profile with a visible tail, wing, face,
and open beak. The enclosing shape is a speech bubble, so the mark still reads
as voice at favicon size.

The bird carries the colour. The workspace remains composed and usable.

- Blue wing and tail: clarity and evidence.
- Green crown and back: growth and preparation.
- Yellow chest: attention and energy.
- Orange open beak: warmth and the act of speaking.
- Black bubble: seriousness and contrast.
- White face patch: legibility at small sizes.

### Mascot behaviour

The bird may welcome, explain an empty state, point to the next step, or invite
a student to answer in their own words. It never celebrates a “pass,” scolds a
“failure,” or presents an ability score. It is a rehearsal partner, not a judge.

### Mark rules

- Use the captain-supplied `src/assets/LOGO.png`; do not redraw or
  auto-vectorise it per surface. The dashboard-only
  `src/assets/LOGO-dashboard.png` changes only the canvas transparency and
  preserves the supplied bird and white speech-bubble interior.
- Preserve the full body. Do not crop the mark down to the head.
- Preserve the supplied colours in the application and booth mark. Apparel is
  the deliberate exception: use the one-ink asset described below.
- Keep the speech-bubble frame and listening dots around the bird.
- At small sizes, remove supporting copy before shrinking the mark below 32px.
- On apparel, use `src/assets/macaw-mark-white.svg`; never recolour the
  full-colour application asset by eye.

### Talk-Active lockup

The product logo is the full-colour speaking-bird mark plus the `Talk-Active`
wordmark. Keep the hyphen: speaking and acting read as one connected idea.
`Active` may take one bird-palette accent—yellow on the dark application shell,
deep leaf on light landing surfaces—but the rest of the name stays black or
white. Do not show a generic text-only product name where the lockup fits.
Use `src/assets/LOGO & TAGLINE.png` only where the complete lockup has enough
space to keep its wordmark and tagline legible. Use `LOGO-dashboard.png` for
workspace navigation, workflow markers, and the workspace favicon; use
`LOGO.png` for the public brief and booth.
The two supplied PNGs remain untouched. The derived dashboard file has a
transparent outer canvas and a white speech-bubble interior; the interface
must not add a second background tile around it.

### Character render

`src/assets/macaw-mascot-3d.webp` is the larger character expression for
welcome and explanation surfaces. It keeps the same full-body bird, supplied
palette, and black speech-bubble ground as the small mark, but adds dimensional
feather forms and a forward wing gesture. The SVG remains the source for logos,
navigation, small empty states, print, and apparel; the render never replaces
the mark at identity sizes.

Character movement is restrained: a slow greeting motion and one short speech
bubble. It stops under `prefers-reduced-motion`. The bird points to the next
rehearsal action; it does not celebrate scores or become a game mechanic.

---

## 3. Colour

The captain supplied the speaking-bird palette. Its exact values are tested.

| Primitive | Hex | Role |
|---|---:|---|
| Sky blue | `#1B7EA6` | Evidence, matched cues, practice guidance |
| Deep leaf | `#2F5923` | Shell, primary action, structure |
| Bright leaf | `#3A731F` | Selected navigation and setup context |
| Sunlight | `#F2B90C` | Attention, timing, mascot chest |
| Warm orange | `#BF6B04` | Mascot beak and small warm details |
| Near black | `#101312` | Text and logo ground |
| Warm white | `#FFFEF9` | Primary surface |

Components never request those primitives directly. They ask for semantic roles:

| Token | Meaning |
|---|---|
| `--brand`, `--brand-hover`, `--brand-wash` | Green product structure and actions |
| `--evidence`, `--evidence-strong`, `--evidence-wash` | Cited transcript evidence only |
| `--absence`, `--absence-wash` | No cue matched; neutral, never red |
| `--accent-sky` | Non-verdict practice guidance |
| `--accent-leaf` | Setup and navigation context only |
| `--accent-sun` | Attention, timing, small highlights |
| `--accent-orange` | Warm micro-detail; never a large field |
| `--surface-*`, `--text-*`, `--border-*` | Application material and hierarchy |

### Green is structure, never a result

Green is part of the bird and the product shell. It must not colour evidence
coverage, a criterion verdict, a defense status, or a progress score. Those
contexts would turn green into “passed,” contradicting INV-2 and INV-4. A test
inspects selectors using both `--brand` and `--accent-leaf` for this reason.

### Contrast

Every foreground/background pair used by the product and booth is computed from
the shipped tokens and tested against WCAG AA. The evidence pair is checked
most strictly because the citation is the differentiator.

---

## 4. Typography

`--font-ui` is the platform sans. It is the application speaking.

`--font-voice` is Georgia with platform fallbacks. It is a person speaking: a
quoted transcript span or the judge’s question. The serif is never applied to a
score, badge, avatar, or decorative heading.

Both stacks resolve locally. The application does not claim to ship a web font
that its CSP prevents it from loading.

### Scale

| Token | Size | Use |
|---|---:|---|
| `--step-0` | 12px | overline, metadata, badges |
| `--step-1` | 15px | body |
| `--step-2` | 19px | card title |
| `--step-3` | 23px | section heading |
| `--step-4` | 29px | page title |
| `--step-5` | 37px | hero |
| `--step-6` | 46px | booth headline |
| `--step-evidence` | 29–37px | cited user speech |

No component invents a font size outside this scale.

---

## 5. Material and depth

Talk-Active does not use blurred floating-card shadows. They made the product
look assembled from a generic UI kit and competed with the authenticity of the
bird identity.

Depth comes from four more specific devices:

- **Crisp paper edges:** a one-pixel outline with a heavier bottom rule.
- **Character-led display surfaces:** the public landing page and dashboard home may use
  two-pixel black outlines with small, unblurred offset shadows in bird colours. This is
  printed-poster registration, not floating-card depth.
- **Speech-bubble asymmetry:** three rounded corners and one tighter corner.
- **Voice contours:** thin concentric lines on dark hero surfaces, suggesting
  sound travelling outward rather than a decorative glow.
- **Dimensional character:** 3D rendering is reserved for the bird itself. The
  surrounding product UI stays crisp, flat, and readable.

The canvas carries a nearly invisible paper grain. It must disappear before it
reduces text clarity. There are no decorative gradients, glass cards, or soft
drop shadows. Hard offset shadows stay on the landing and dashboard home; dense
practice and review screens keep the calmer paper treatment.

### Expressiveness hierarchy

- **Landing page — 200%:** large character art, visible directional assets,
  tilted paper, bold black outlines, and 8–16px hard offsets. Each numbered
  section earns one useful visual that explains the product.
- **Dashboard home — 60%:** full character plus 4px hard offsets. It feels
  recognizably related to the landing page without becoming a poster.
- **Practice, review, judge room, rubric, progress — 30%:** a small Kato mark in
  a pale-yellow Home-style header, deep-green actions, warm-white cards, and
  plain black outlines. These work surfaces use no decorative shadows or
  route-specific colour stripes. Evidence remains more visually dominant than
  brand decoration.

Spacing follows the 4px scale in `tokens.css`. Raw spacing literals do not enter
component CSS.

---

## 6. Core components

### Citation card

The citation card is the most important component.

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

Rules:

- One column. Two quotes never compete side by side.
- The quote is larger than the criterion label.
- Blue is used only when a cited span exists.
- Provenance always appears beneath a cited span.
- User text is inserted through `textContent`, never markup.

### No-cue card

The absence state is plain paper with a neutral rule. It explicitly lists the
cues the analyzer looked for. It never uses red, green, an X icon, or an empty
panel.

### Coverage

Evidence coverage is small and fully labelled. It is supporting context, not a
confidence or ability score. Green is prohibited here. Trend bars use sky blue;
headline values remain black.

### Primary action

Primary actions use deep leaf green with a warm-white label. Buttons are pills,
but surfaces are not all pills. The shape distinguishes actions from content.

### Empty guidance

The full-body bird may appear at 64–96px beside one short instruction. The
mascot does not fill space with chatter; it makes the next action clearer.

---

## 7. Application surface

The application is light because students write and read dense text, demo
screens are unpredictable, and light surfaces remain legible in exhibition
lighting.

- Warm-white cards sit on a quiet off-white canvas.
- The sidebar and focus hero use deep leaf green.
- The dashboard home carries the same crisp black outlines, bird-colour offset
  shadows, and full-body character as the public landing page.
- Yellow marks current attention and time.
- Blue guides practice and owns evidence.
- Orange remains a micro-accent, primarily in the mascot.

The interface should feel colourful because the roles are visible, not because
every card has a different background. The expressive dashboard home invites
the next rehearsal; practice and evidence screens then become quieter so the
student's words remain dominant.

---

## 8. Booth and apparel

The booth surface uses near black as its ground so the supplied bird palette is
visible from two metres. The application laptop stays light. Both surfaces use
the same semantic token names.

The team shirt reverses the normal colour relationship: the **fabric carries
the accent colour** and every printed element is one warm-white ink. Use
`src/assets/macaw-mark-white.svg`, which keeps the full-body bird readable
inside a white speech-bubble outline through negative space.

- Primary fabric: sky blue `#1B7EA6`.
- Approved alternate: deep leaf `#2F5923` when the blue blank is unavailable.
- Print: warm white `#FFFEF9`, one ink, no simulated process colour.
- Do not use the yellow or orange palette colours as the shirt ground; white
  does not have enough contrast on them for the small chest lockup.
- Front: compact left-chest bird and Talk-Active wordmark.
- Back: large speaking-bird mark, “Practice the answer before the question,”
  then the product loop: project → rubric → attempt → evidence → defend.

The source-of-truth render is `docs/design/preview/apparel.png`, generated by
`pnpm design:preview`. Request a physical proof before ordering; screen RGB
values are not a fabric or ink specification.

---

## 9. Young-adult product rules

Young-adult appeal is a behaviour requirement, not an excuse for novelty.

- Mobile first: the full project → rubric → attempt → evidence → defense path
  works at 390px with no horizontal overflow.
- Fast: no client runtime dependencies, no external font or image requests.
- Bite-sized: one clear action and short supporting copy per stage.
- Personal: a recognizable speaking bird and direct, non-corporate language.
- Interactive: quick transitions and visible state changes, with reduced-motion
  support.
- Serious: dimensional character art is allowed; fake depth across the UI,
  neon glow, cartoon scoring, and gamified streaks are not.

---

## 10. Enforcement

`test/design-system.test.mjs` fails the gate when:

- a component invents a raw colour, font size, or spacing value;
- a component reaches for a primitive palette token;
- blue evidence roles appear outside evidence contexts;
- the voice typeface appears outside quoted speech;
- green structure colours a verdict or score;
- a verdict uses danger or caution colours;
- supplied bird-palette values drift;
- contrast drops below the required ratio;
- the evidence type step stops outranking the page title;
- a named typeface is neither a platform font nor a shipped asset.

The system is complete only when the exact demo path and `pnpm check` remain
green.
