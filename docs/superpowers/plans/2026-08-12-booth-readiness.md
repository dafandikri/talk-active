# Booth Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the exhibition path survive a stranger on their own phone — kiosk reset between visitors, no reachable blank state, and a clean 390px pass.

**Architecture:** Pure frontend work in the existing vanilla structure. `src/app.mjs` already exposes `initialWorkspace` and `STORAGE_KEY`; reset reuses them rather than defining a second seed. No API, no new module, no dependency.

**Tech Stack:** Native ES modules, `localStorage`, CSS custom properties, `node:test` + `scripts/browser-check.mjs`.

**Runs fully in parallel with [`2026-08-12-finals-hardening.md`](2026-08-12-finals-hardening.md).** That plan owns `src/semantic.mjs`, `api/`, and `src/rubric-import.mjs`. This one owns `src/styles.css` and the layout half of `src/app.mjs`. The only shared file is `src/app.mjs`; the two plans touch different functions in it, so merge conflicts should be trivial — but merge often.

## Global Constraints

- **No new runtime dependencies.**
- **`textContent` only.** Never `innerHTML`, `outerHTML`, `insertAdjacentHTML` (INV-5).
- **No external resources.** No CDN fonts, scripts, or images — the demo gate's `no-external-dependencies` step fails the build otherwise, and the offline laptop depends on it.
- **Never claim a capability the build lacks** (INV-2).
- **Zero console errors** on every path. The demo gate asserts an empty console array.
- **`pnpm check` must pass before every commit.**
- Test style: `import test from 'node:test'; import assert from 'node:assert/strict';`
- Existing identifiers to reuse, not redefine: `STORAGE_KEY = 'talkactive.workspace.v1'`, `DICTATION_LANGUAGE_KEY`, `initialWorkspace`, `clone()`, `loadWorkspace()`, `saveWorkspace()`.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `src/app.mjs` | Kiosk reset, empty/loading/error states, route rendering | Modify |
| `index.html` | Reset control markup, empty-state containers | Modify |
| `src/styles.css` | 390px rules, state styling | Modify |
| `scripts/browser-check.mjs` | Reset + empty-state + mobile checks | Modify |
| `scripts/demo-gate.mjs` | Kiosk reset step | Modify |

---

## Task 1: Kiosk reset

A booth visitor must not inherit the previous visitor's session. Reset restores the seed workspace without touching device-level preferences.

**Files:**
- Modify: `index.html`, `src/app.mjs`, `src/styles.css`
- Test: `scripts/browser-check.mjs`

**Interfaces:**
- Consumes: `STORAGE_KEY`, `initialWorkspace`, `clone()`, `render()` — all already in `src/app.mjs`
- Produces: `resetWorkspace() => void`

- [ ] **Step 1: Add the control**

In `index.html`, in the app header:

```html
<button type="button" class="kiosk-reset" id="kioskReset">Start fresh</button>
```

Label it "Start fresh", not "Reset" — a visitor should read it as an invitation, not a warning.

- [ ] **Step 2: Implement reset**

In `src/app.mjs`:

```js
// Booth visitors arrive one after another. Reset restores the seed workspace
// so nobody inherits the previous visitor's session.
//
// DICTATION_LANGUAGE_KEY is deliberately NOT cleared: it describes this
// device's microphone, not the visitor's work, and re-picking a language at
// every handover is friction with no privacy benefit.
function resetWorkspace() {
  state.workspace = clone(initialWorkspace);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.workspace));
  } catch {
    // Private mode: the in-memory reset above is still correct.
  }
  state.route = 'home';
  render();
  showToast('Workspace reset — ready for the next visitor');
}
```

- [ ] **Step 3: Write the browser check**

In `scripts/browser-check.mjs`, add a `kiosk-reset` check: create a project, click `#kioskReset`, assert the project list is back to exactly one project named `Talk-Active — RISTEK Hackathon`, and that the dictation language preference is unchanged.

- [ ] **Step 4: Run the browser check**

Run: `pnpm test:browser`
Expected: PASS with the new check

- [ ] **Step 5: Add a demo-gate step**

In `scripts/demo-gate.mjs`, after `survives-reload`, add a `kiosk-reset` step asserting reset completes and re-renders with zero console output.

- [ ] **Step 6: Run the gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add index.html src/app.mjs src/styles.css scripts/browser-check.mjs scripts/demo-gate.mjs
git commit -m "Give the booth a one-click handover

Visitors arrive back to back; nobody should meet the previous person's
half-finished session. Device microphone preference survives the reset."
```

---

## Task 2: No blank panel is reachable

Every view must say something useful when it has no data. A blank panel in front of a judge reads as a bug even when it is correct.

**Files:**
- Modify: `src/app.mjs`, `index.html`, `src/styles.css`
- Test: `scripts/browser-check.mjs`

- [ ] **Step 1: Enumerate the empty states**

Four exist, and each needs copy that says what to do next:

| View | Empty when | Copy |
|---|---|---|
| Home | no sessions yet | "No attempts yet. Start one to see which criteria your draft already covers." |
| Progress | fewer than 2 sessions | "Practise twice to see what changed between attempts." |
| Rubric | rubric is empty | "Add a criterion, or import an evaluator's scoring matrix." |
| Practice review | analysis returned no criteria | "No criteria to review — check the rubric for this project." |

- [ ] **Step 2: Implement the empty states**

For each, render a `<p class="empty-state">` via `textContent` when the collection is empty, and hide the chart or list container. Never render an empty container with a heading above it.

- [ ] **Step 3: Add a loading state to analysis**

Analysis can take up to 25s while the failover chain runs (see the hardening plan, Task 1). A frozen button reads as a crash:

```js
// The chain may try three vendors. Silence for 25 seconds is indistinguishable
// from a hang, and a judge will read it as one.
elements.analyseButton.disabled = true;
elements.analyseStatus.textContent = 'Analysing against your rubric…';
```

Clear both in a `finally` block so a thrown error cannot strand the button.

- [ ] **Step 4: Write the browser checks**

Add an `empty-states` check: reset the workspace, visit each of the four views, assert each shows non-empty text and no empty container with a bare heading.

- [ ] **Step 5: Run the gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add src/app.mjs index.html src/styles.css scripts/browser-check.mjs
git commit -m "Say something useful when there is nothing to show

A blank panel reads as a bug even when it is correct, and analysis can
run 25 seconds while the vendor chain works."
```

---

## Task 3: 390px pass across the judge path

Booth visitors use their own phones. 390px is the iPhone reference width.

**Files:**
- Modify: `src/styles.css`
- Test: `scripts/browser-check.mjs`

- [ ] **Step 1: Add the mobile check**

Extend `scripts/browser-check.mjs` to walk the full judge path — home → practice → attempt → analyse → review → defend → progress → rubric — at a 390px viewport, asserting after each step that `document.documentElement.scrollWidth <= 390` and that the console stayed empty.

- [ ] **Step 2: Run it and collect the failures**

Run: `pnpm test:browser`
Expected: FAIL, listing each view that overflows. Fix them one at a time — do not batch.

- [ ] **Step 3: Fix overflow at its source**

Typical causes here, in order of likelihood: fixed-width `.rubric-row` grid columns, the progress chart's minimum width, and long unbroken transcript text. Prefer `minmax(0, 1fr)` and `overflow-wrap: anywhere` over horizontal scroll containers. **Do not fix overflow with `overflow-x: hidden`** — that hides the symptom and clips content on a judge's phone.

- [ ] **Step 4: Verify tap targets**

Every button and select on the judge path is at least 44×44 CSS pixels.

- [ ] **Step 5: Run the gate**

Run: `pnpm check`
Expected: all green, full path at 390px, zero overflow, zero console errors

- [ ] **Step 6: Commit**

```bash
git add src/styles.css scripts/browser-check.mjs
git commit -m "Make the judge path work on the phone a visitor actually brings

Overflow is fixed at the source rather than clipped, so nothing is
hidden on a narrow screen."
```

---

## Task 4: Per-criterion engine label

**Depends on Task 3 of the hardening plan**, which adds `criterion.engine`. Coordinate before starting — if that field does not exist yet, this task cannot be tested.

**Files:**
- Modify: `src/app.mjs`, `src/styles.css`

- [ ] **Step 1: Confirm the dependency landed**

Run: `node --test test/semantic.test.mjs`
Expected: the test `each criterion reports which engine actually answered it` passes. If it does not exist, stop and coordinate.

- [ ] **Step 2: Render the label**

See Task 4 of the hardening plan for the exact markup and CSS. Implement it there or here, once — not both.

- [ ] **Step 3: Run the gate**

Run: `pnpm check`
Expected: all green

---

## Self-Review

**Spec coverage.** Task 1 covers B3, Task 2 covers B4, Task 3 covers B5, Task 4 covers the visible half of P0-3. Together with the hardening plan this closes every demo-critical item in `2026-08-11-backlog.md` §1 except A6 (owned by the hardening plan), and the pitch/booth/evidence items, which are not implementation work.

**Type consistency.** `resetWorkspace()` takes no arguments and returns nothing. `criterion.engine` is `'semantic' | 'deterministic'`, matching the hardening plan's Task 3. `STORAGE_KEY`, `initialWorkspace`, and `clone()` are used with their existing signatures and are not redefined.

**Ordering.** Tasks 1–3 are independent and can be done in any order. Task 4 blocks on the hardening plan's Task 3.
