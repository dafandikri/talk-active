# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public landing page at `/` with a split hero, a restored four-step loop, editorial typography, casual Indonesian copy, and depth-treated mascot art — without touching the workspace.

**Architecture:** One React component (`production-shell.tsx`) renders four sections; all copy lives in the `landing` message namespace in both locales; all styling lives in `apps/web/app/shell.css`, whose `.production-shell__loop` rules already survive from the removed section. No JavaScript is added — depth comes from CSS shadow, gradient and transform.

**Tech Stack:** Next.js App Router (server component), next-intl, plain CSS with design tokens from `src/tokens.css`, node:test, Playwright.

**Spec:** `docs/specs/2026-08-18-landing-page-design.md`

## Global Constraints

- **Blue is reserved for cited evidence.** `--evidence`, `--evidence-strong`, `--evidence-wash`, `--accent-sky` appear only on the mascot and the demo/evidence card. Enforced by `test/design-system.test.mjs`.
- **No new dependencies, no external hosts.** CSP is `default-src 'self'`. Artwork is bundled like any asset.
- **All user-facing copy goes through `t()`** in the `landing` namespace, present in both `apps/web/messages/id.json` and `apps/web/messages/en.json`. `test/i18n.test.mjs` enforces key parity, no blanks, and a ceiling on byte-identical entries.
- **Indonesian is the default locale.** Write `id` copy first; `en` is the translation.
- **Casual register (`kamu`) applies to the `landing` namespace only.** No other namespace may contain `kamu`.
- **Use existing type steps.** `--step-0` through `--step-6` exist in `src/tokens.css`. Do not add a step.
- **`prefers-reduced-motion: reduce` removes every transform and transition** added by this work.
- **`pnpm check` is the definition of done.** Run `pnpm build` before `pnpm test:production:browser` — the browser suite serves the existing build.

---

### Task 1: Restore the loop section and replace the prohibition

The loop's CSS survives in `shell.css`; only its markup was removed. This task brings back the markup, adds its copy, and deliberately replaces the test that forbids it.

**Files:**
- Modify: `apps/web/components/production-shell.tsx`
- Modify: `apps/web/messages/id.json`, `apps/web/messages/en.json`
- Modify: `apps/web/app/shell.css:42` (grid columns 5 → 4)
- Test: `test/nielsen-heuristics.test.mjs:348`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: message keys `loopTitle`, `loopStep1Title`…`loopStep4Title`, `loopStep1Body`…`loopStep4Body` in the `landing` namespace; a `<section className="production-shell__loop">` in `production-shell.tsx`.

- [ ] **Step 1: Write the failing test**

Replace `test/nielsen-heuristics.test.mjs:348` (the line `assert.doesNotMatch(LANDING, /How it works/u, ...)`) with:

```js
  // Replaces a prohibition that arrived inside an unrelated integration merge
  // (d79ed24) with no recorded reasoning. The commit it appears to reference,
  // 5a8cd66, explicitly KEPT this section — and its CSS was never removed from
  // shell.css, only the markup. What that commit actually cared about was that
  // the loop speak in the user's terms rather than ours, so that is asserted here.
  assert.match(LANDING, /production-shell__loop/u,
    'the landing page must explain the loop it is selling');
  everyLocaleTranslates('landing', 'loopStep1Title', 'the loop must name what the user does');
  everyLocaleTranslates('landing', 'loopStep4Title', 'the loop must end on the evidence');
  assert.doesNotMatch(
    LANDING,
    /\b(stateless|deterministic|criterionEngines|semanticAvailable)\b/u,
    'the landing loop must not name internal stages',
  );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/nielsen-heuristics.test.mjs`
Expected: FAIL — `the landing page must explain the loop it is selling` (the markup does not exist yet).

- [ ] **Step 3: Add the copy to both catalogues**

In `apps/web/messages/id.json`, inside the `"landing"` object:

```json
"loopTitle": "Empat langkah, satu bukti.",
"loopStep1Title": "Bikin proyek",
"loopStep1Body": "Satu tempat buat satu presentasi yang kamu siapkan.",
"loopStep2Title": "Tempel rubriknya",
"loopStep2Body": "Rubrik asli yang bakal dipakai buat menilai kamu, bukan contoh umum.",
"loopStep3Title": "Latihan sekali jalan",
"loopStep3Body": "Ketik atau ucapkan. Kamera dan mikrofon tetap mati sampai kamu nyalain.",
"loopStep4Title": "Lihat buktinya",
"loopStep4Body": "Kalimat kamu sendiri, dipetakan ke tiap kriteria — plus yang masih kurang."
```

In `apps/web/messages/en.json`, inside `"landing"`:

```json
"loopTitle": "Four steps, one piece of evidence.",
"loopStep1Title": "Make a project",
"loopStep1Body": "One place for one talk you are preparing.",
"loopStep2Title": "Paste the rubric",
"loopStep2Body": "The real one you will be marked against, not a generic example.",
"loopStep3Title": "Rehearse it once",
"loopStep3Body": "Type it or say it. Camera and microphone stay off until you turn them on.",
"loopStep4Title": "See the evidence",
"loopStep4Body": "Your own sentences mapped to each criterion — and what is still missing."
```

- [ ] **Step 4: Add the markup**

In `apps/web/components/production-shell.tsx`, insert between the closing `</section>` of `production-shell__hero` and the opening of `production-shell__use-cases`:

```tsx
      <section className="production-shell__loop" aria-labelledby="loop-title">
        <div className="production-shell__section-intro">
          <h2 id="loop-title">{t('loopTitle')}</h2>
        </div>
        <ol>
          <li><span>1</span><h3>{t('loopStep1Title')}</h3><p>{t('loopStep1Body')}</p></li>
          <li><span>2</span><h3>{t('loopStep2Title')}</h3><p>{t('loopStep2Body')}</p></li>
          <li><span>3</span><h3>{t('loopStep3Title')}</h3><p>{t('loopStep3Body')}</p></li>
          <li className="production-shell__evidence-step"><span>4</span><h3>{t('loopStep4Title')}</h3><p>{t('loopStep4Body')}</p></li>
        </ol>
      </section>
```

- [ ] **Step 5: Fix the grid width**

In `apps/web/app/shell.css:42`, change `repeat(5, minmax(0, 1fr))` to `repeat(4, minmax(0, 1fr))`. The rule was written for the five-step version that was removed.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test`
Expected: PASS, 486 → 486 (no new test count; one assertion replaced by four).

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/production-shell.tsx apps/web/app/shell.css apps/web/messages/id.json apps/web/messages/en.json test/nielsen-heuristics.test.mjs
git commit -m "Restore the loop the landing page was selling without explaining"
```

---

### Task 2: Move the landing copy to casual register

The register change is the actual GenZ lever. Doing it before the visual work means the layout is designed around the real sentence lengths.

**Files:**
- Modify: `apps/web/messages/id.json`, `apps/web/messages/en.json`
- Modify: `apps/web/components/production-shell.tsx` (headline splits across two lines)
- Test: `test/i18n.test.mjs` (new assertion)

**Interfaces:**
- Consumes: the `landing` namespace from Task 1.
- Produces: `titleLine1`, `titleLine2` replacing `title`; all `landing` values in `kamu`.

- [ ] **Step 1: Write the failing test**

Append to `test/i18n.test.mjs`:

```js
// The register is the point of the landing redesign, and it is exactly the kind
// of thing that silently reverts when someone edits one string. `Anda` is the
// form you use with a stranger; the front door speaks as a peer, and nothing
// behind the workspace frame does.
test('the landing namespace speaks casually and no other namespace does', () => {
  const id = catalogue('id');
  const landingText = Object.values(id.landing).join(' ');
  assert.match(landingText, /\bkamu\b/iu, 'the landing page must address the reader as kamu');
  assert.doesNotMatch(landingText, /\bAnda\b/u, 'the landing page must not mix in the formal register');

  for (const [namespace, entries] of Object.entries(id)) {
    if (namespace === 'landing') continue;
    const text = Object.values(entries).join(' ');
    assert.doesNotMatch(text, /\bkamu\b/iu,
      `${namespace} must keep the formal register; casual copy is landing-only`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/i18n.test.mjs`
Expected: FAIL — `the landing page must address the reader as kamu`.

- [ ] **Step 3: Rewrite the Indonesian landing copy**

Replace these keys in `apps/web/messages/id.json` under `"landing"`:

```json
"titleLine1": "Buktiin",
"titleLine2": "klaimmu.",
"lede": "Bukan skor. Bukan penilaian gaya bicara. Cuma kalimat kamu sendiri, dipetakan ke rubrik yang bakal menilai kamu.",
"start": "Mulai berlatih",
"startNow": "Mulai sekarang",
"useCasesTitle": "Satu cara, banyak ruangan yang menentukan.",
"useCase1Body": "Hubungkan klaim produk kamu ke rubrik penilaian sebelum sesi tanya jawab.",
"useCase2Body": "Bikin tiap kriteria seleksi kelihatan jelas di jawaban yang kamu latih.",
"useCase3Body": "Temukan bagian metode atau kesimpulan yang penjelasannya masih goyah.",
"useCase4Body": "Ruangan mana pun yang hasilnya ditentukan rubrik tertulis.",
"footerTagline": "Latihan berbasis rubrik buat jawaban yang butuh bukti."
```

Delete the old `"title"` key.

- [ ] **Step 4: Rewrite the English landing copy**

Replace in `apps/web/messages/en.json` under `"landing"`:

```json
"titleLine1": "Prove",
"titleLine2": "your claim.",
"lede": "No score. No speaking-ability rating. Just your own sentences, mapped to the rubric you will be marked against.",
"start": "Start practising",
"startNow": "Start now",
"useCasesTitle": "One method, plenty of rooms that decide things.",
"useCase1Body": "Connect your product claims to the scoring rubric before the Q&A.",
"useCase2Body": "Make each selection criterion obvious in the answer you rehearse.",
"useCase3Body": "Find where a method or conclusion still wobbles.",
"useCase4Body": "Any room where a written rubric decides the outcome.",
"footerTagline": "Rubric-grounded rehearsal for answers that need evidence."
```

Delete the old `"title"` key.

- [ ] **Step 5: Update the headline markup**

In `apps/web/components/production-shell.tsx`, replace the `<h1>` line:

```tsx
          <h1 className="production-shell__title" id="production-title">
            {t('titleLine1')}<br /><span className="production-shell__title-accent">{t('titleLine2')}</span>
          </h1>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test`
Expected: PASS. `test/i18n.test.mjs` reports 6 tests passing.

- [ ] **Step 7: Commit**

```bash
git add apps/web/messages/id.json apps/web/messages/en.json apps/web/components/production-shell.tsx test/i18n.test.mjs
git commit -m "Let the landing page speak to a student, not to a stranger"
```

---

### Task 3: Editorial treatment and mascot depth

The scale jump already exists (`--step-6` over `--step-1`). What is missing is weight, tracking, the accent on the second line, and depth on the mascot.

**Files:**
- Modify: `apps/web/app/shell.css:17` and append a new block
- Modify: `apps/web/components/production-shell.tsx` (mascot image in the hero)
- Test: `test/design-system.test.mjs` (new assertion)

**Interfaces:**
- Consumes: `production-shell__title-accent` from Task 2.
- Produces: `.production-shell__kato` wrapper class for the drop-in artwork swap.

- [ ] **Step 1: Write the failing test**

Append to `test/design-system.test.mjs`:

```js
// The landing's depth is CSS, not a 3D runtime — the CSP forbids external hosts
// and a booth runs on hotel Wi-Fi. This pins that decision so nobody reaches for
// a WebGL dependency later without changing the spec first.
test('the landing mascot gets its depth from CSS and reduces for motion sensitivity', () => {
  assert.match(NEXT_SHELL_STYLES, /\.production-shell__kato\b/u, 'the mascot needs a sized wrapper');
  assert.match(NEXT_SHELL_STYLES, /\.production-shell__kato[^}]*filter:\s*drop-shadow/u,
    'depth must come from a shadow, not a 3D runtime');
  assert.match(
    NEXT_SHELL_STYLES,
    /@media \(prefers-reduced-motion: reduce\)[^}]*\{[\s\S]*?\.production-shell__kato/u,
    'the mascot must hold still when motion is reduced',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/design-system.test.mjs`
Expected: FAIL — `the mascot needs a sized wrapper`.

- [ ] **Step 3: Add the editorial type treatment**

Replace `apps/web/app/shell.css:17` with:

```css
.production-shell__title { max-width: 11ch; margin-bottom: var(--space-5); font-size: var(--step-6); font-weight: var(--weight-heavy); line-height: .96; letter-spacing: -0.04em; }
.production-shell__title-accent { color: var(--accent-sun); }
```

`--accent-sun` is the orange already used for the eyebrow dot and the primary action, so no new colour enters the page and the evidence blue is untouched.

- [ ] **Step 4: Add the mascot with CSS depth**

Append to `apps/web/app/shell.css`:

```css
.production-shell__kato { position: absolute; left: calc(-1 * var(--space-7)); bottom: calc(-1 * var(--space-5)); width: 11rem; aspect-ratio: 1 / 1.18; }
.production-shell__kato img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 1.25rem 1.5rem rgb(0 0 0 / 0.28)); transform: translateY(0) rotate(-3deg); transition: transform 420ms ease; }
.production-shell__demo:hover .production-shell__kato img { transform: translateY(-0.35rem) rotate(-3deg); }

@media (prefers-reduced-motion: reduce) {
  .production-shell__kato img { transition: none; }
  .production-shell__demo:hover .production-shell__kato img { transform: rotate(-3deg); }
}
```

- [ ] **Step 5: Move the mascot into its wrapper**

In `apps/web/components/production-shell.tsx`, replace the bare `<img src={mascot.src} alt="" />` inside `production-shell__demo` with:

```tsx
          <div className="production-shell__kato">
            <img src={mascot.src} alt="" width={176} height={208} />
          </div>
```

The explicit `width`/`height` reserve the space so the page does not shift when the artwork loads, and they are what a real render later has to match.

- [ ] **Step 6: Delete the superseded rule**

Remove the old `.production-shell__demo > img { … }` rule from `shell.css` (the last line of the hero block). It positions an image that is now wrapped, so leaving it would fight the new rule.

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/shell.css apps/web/components/production-shell.tsx test/design-system.test.mjs
git commit -m "Give the landing hero its weight and the mascot its depth"
```

---

### Task 4: Update the browser suite and prove the page holds together

Three existing specs enter through the landing page and assert its heading and CTA by name. All three break on the new copy.

**Files:**
- Modify: `e2e/production-ui/golden-path.spec.ts:42-43`
- Modify: `e2e/production-ui/navigation-history.spec.ts:30,36`
- Modify: `e2e/production-ui/interface-language.spec.ts:88`
- Test: `e2e/production-ui/interface-language.spec.ts` (new checks)

**Interfaces:**
- Consumes: the copy from Task 2 and the markup from Tasks 1 and 3.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `e2e/production-ui/interface-language.spec.ts`:

```ts
test('the landing hero and loop hold together at 390px and keep the CTA reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // Copy first when stacked: a visitor must read the sentence before the art.
  await expect(page.getByRole('heading', { name: /Buktiin/ })).toBeVisible();
  await expect(page.locator('.production-shell__loop li')).toHaveCount(4);

  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBe(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  const cta = page.locator('.production-shell__action').first();
  const box = await cta.boundingBox();
  expect(box, 'the call to action must have rendered bounds').not.toBeNull();
  expect((box?.y ?? 720) + (box?.height ?? 0)).toBeLessThanOrEqual(720);
});
```

- [ ] **Step 2: Update the three existing specs**

In `e2e/production-ui/golden-path.spec.ts` and `e2e/production-ui/interface-language.spec.ts`, replace
`{ name: 'Latih klaim yang akan ditantang juri berikutnya.' }` with `{ name: /Buktiin/ }`.

In `e2e/production-ui/interface-language.spec.ts`, the English half of the locale test: replace
`{ name: 'Rehearse the claim a judge will challenge next.' }` with `{ name: /Prove/ }`.

In all three files, `/^Mulai berlatih\b/i` and `/Mulai berlatih/i` still match the new `start` value and need no change. Verify rather than assume: `grep -rn "Mulai berlatih" e2e/`.

- [ ] **Step 3: Build, then run the browser suite**

Run: `pnpm build && pnpm test:production:browser`
Expected: the new test fails first if run before Tasks 1–3 land; after them, all specs pass. If a selector fails, fix the selector — never the component — unless the component genuinely lost a property the spec asserts.

- [ ] **Step 4: Run the full gate**

Run: `pnpm check`
Expected: exit 0. Unit and invariant tests, production typecheck and build, browser interaction, artifact health.

- [ ] **Step 5: Commit**

```bash
git add e2e/production-ui/
git commit -m "Walk the browser suite through the rebuilt landing page"
```

---

### Task 5: Record what shipped and what is still owed

**Files:**
- Modify: `docs/specs/2026-08-18-landing-page-design.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add a status section**

At the top of the spec, below the scope block:

```markdown
## Status — 18 August 2026

Implemented. The loop is restored, the copy is casual, the hero carries the
editorial treatment, and the mascot has CSS depth.

**Still owed:** the depth-rendered artwork. `production-shell__kato` is sized for a
drop-in swap at 176×208; replacing `kato-macaw-reading.svg` with a real render
needs no code change. Until then the CSS shadow does the work, which is what D5
bought and is not a placeholder.

**Not done, deliberately:** `/enter` still says `Anda`, so a visitor shifts register
in one click. D4 scoped the change to the landing namespace and this held to it.
```

- [ ] **Step 2: Commit**

```bash
git add docs/specs/2026-08-18-landing-page-design.md
git commit -m "Record what the landing redesign shipped and what it still owes"
```

---

## Self-review

**Spec coverage.** D1 split hero → Task 3. D2 structure → Task 1. D3 editorial → Task 3. D4 register → Task 2. D5/D6 artwork → Task 3. D7 product untouched → no task modifies anything outside `production-shell.tsx`, `shell.css`, and the `landing` namespace. D8 prohibition → Task 1. Testing section → Task 4. The "still owed" artwork note → Task 5.

**Placeholder scan.** No TBD, no "handle edge cases", no "similar to Task N". Every code step carries the code.

**Type consistency.** `production-shell__title-accent` is created in Task 2 (markup) and styled in Task 3 (CSS) — ordering is correct, and Task 3 declares the dependency. `production-shell__kato` is created and styled in the same task. Message keys `titleLine1`/`titleLine2` replace `title` in Task 2, and Task 4's selectors match the new values. `loopStep1Title` and `loopStep4Title` are asserted in Task 1 and defined in the same task.

**Verified against the real files while reviewing.** `design-system.test.mjs` names the
variable `NEXT_SHELL_STYLES`, not `SHELL_STYLES` — corrected in Task 3.
`production-shell__section-intro` already exists in `shell.css`, so Task 1's markup
needs no new class. And `landing.title` is read only by `production-shell.tsx`, so
Task 2 can delete it safely.

**One risk the plan cannot remove.** Task 2 deletes the `title` key while `test/i18n.test.mjs` scans components for keys that must exist. If any component outside the landing still reads `landing.title`, the scan fails — run `grep -rn "landing'" apps/web` before deleting. The plan's Task 2 Step 6 catches it either way, because the whole unit suite runs there.
