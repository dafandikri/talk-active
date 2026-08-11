# Finals Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four verified AI-layer defects and build rubric import — the one missing feature the pitch's hero moment depends on — on the shipping vanilla build.

**Architecture:** All work stays in the existing zero-runtime-dependency structure. Pure logic goes in `src/*.mjs` modules testable without a network; DOM effects stay in `src/app.mjs`; the new import endpoint mirrors `api/analyze.mjs`. Rubric import emits the *existing* `label | cues` line format, so `parseRubric` and the whole data model are untouched.

**Tech Stack:** Node.js 20+, native ES modules, `node:test`, zero runtime dependencies. Vercel Functions for the API.

## Global Constraints

- **No new runtime dependencies.** The client bundle stays dependency-free (AD-6).
- **`textContent` only.** Never `innerHTML`, `outerHTML`, or `insertAdjacentHTML` (INV-5).
- **Every verdict cites evidence.** A supporting verdict without a grounded span is discarded in code, never shown (INV-3).
- **Fail loudly.** Invalid input raises `AnalysisError`; never a silent wrong answer (INV-7).
- **Never claim a capability the build lacks.** No "AI-powered", "confidence score", "understands your argument" (INV-2).
- **Degrade, never break.** Every AI path falls back to the deterministic analyzer (INV-8).
- **`pnpm check` must pass before every commit.** Never weaken a test to go green.
- Test style: `import test from 'node:test'; import assert from 'node:assert/strict';`
- Model chain is read from `MODEL_CHAIN`, never hardcoded vendor names in tests.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `src/semantic.mjs` | Semantic evidence mapping, grounding, failover chain | Modify |
| `src/rubric-import.mjs` | **New.** Pure rubric-structuring logic: prompt, validation, output formatting | Create |
| `api/import-rubric.mjs` | **New.** HTTP entry for rubric import, mirrors `api/analyze.mjs` | Create |
| `src/app.mjs` | DOM effects: client timeout, per-criterion engine badge, import UI | Modify |
| `index.html` | Import panel markup | Modify |
| `test/semantic.test.mjs` | Grounding + provenance + timeout-relationship tests | Modify |
| `test/rubric-import.test.mjs` | **New.** Import validation tests | Create |
| `scripts/demo-gate.mjs` | Add semantic/fallback/import coverage | Modify |

---

## Task 1: Client timeout must exceed the server chain budget

Currently `DEFAULT_TIMEOUT_MS = 12_000` per attempt and `DEFAULT_TOTAL_BUDGET_MS = 22_000` for the chain (`src/semantic.mjs:85-86`), while the client aborts at 15s (`src/app.mjs:603`). Vendor 1 timing out at 12s plus vendor 2 succeeding always exceeds 15s, so **the failover chain can never deliver past vendor 1.**

**Files:**
- Modify: `src/app.mjs:603`
- Test: `test/semantic.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_TOTAL_BUDGET_MS` from `src/semantic.mjs` (already exported)
- Produces: nothing new; a guard test that keeps the two numbers in a valid relationship

- [ ] **Step 1: Write the failing test**

Append to `test/semantic.test.mjs`:

```js
import { readFileSync } from 'node:fs';

// The client aborts on its own clock. If it gives up before the server's chain
// budget expires, a successful failover to a second vendor is thrown away and
// the demo silently shows deterministic mode. These two numbers live in
// different files and nothing else keeps them honest.
test('the client waits longer than the server chain can take', () => {
  const clientSource = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
  const match = clientSource.match(/abort\.abort\(\), (\d[\d_]*)\)/u);

  assert.ok(match, 'could not find the client abort timeout in src/app.mjs');
  const clientTimeoutMs = Number(match[1].replace(/_/gu, ''));

  assert.ok(
    clientTimeoutMs > DEFAULT_TOTAL_BUDGET_MS,
    `client aborts at ${clientTimeoutMs}ms but the server chain may run to ${DEFAULT_TOTAL_BUDGET_MS}ms`,
  );
});
```

Add `DEFAULT_TOTAL_BUDGET_MS` to the existing import block from `../src/semantic.mjs`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/semantic.test.mjs`
Expected: FAIL — `client aborts at 15000ms but the server chain may run to 22000ms`

- [ ] **Step 3: Fix the client timeout**

In `src/app.mjs`, replace the timeout line inside `upgradeWithSemantics`:

```js
  // Must exceed DEFAULT_TOTAL_BUDGET_MS in src/semantic.mjs (22s). The server
  // may try three vendors in sequence; aborting sooner throws away a
  // successful failover and silently downgrades the demo to deterministic.
  // test/semantic.test.mjs enforces this relationship.
  const timer = setTimeout(() => abort.abort(), 25_000);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/semantic.test.mjs`
Expected: PASS

- [ ] **Step 5: Run the full gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add src/app.mjs test/semantic.test.mjs
git commit -m "Let the failover chain finish before the client gives up

The client aborted at 15s while the server chain budget is 22s, so a
vendor-1 timeout followed by a vendor-2 success always arrived too late.
The multi-vendor chain could only ever deliver from the first vendor."
```

---

## Task 2: Grounding must survive whitespace and punctuation variation

`spanIsGrounded` (`src/semantic.mjs:165-169`) does `.trim().toLowerCase()` then `includes()`. A model quoting across a line break, or normalising curly quotes, has a **correct** verdict discarded.

**Files:**
- Modify: `src/semantic.mjs:160-169`
- Test: `test/semantic.test.mjs`

**Interfaces:**
- Produces: `normaliseForGrounding(value: string) => string`, exported for test use. `spanIsGrounded` keeps its `(span, transcript) => boolean` signature.

- [ ] **Step 1: Write the failing test**

```js
test('a correct quote still grounds across line breaks and smart punctuation', () => {
  const transcript = 'We reduced preparation time\nby half, and students said—clearly—it helped.';

  // Same words, single-spaced: a model re-flowing a quote is not fabricating.
  assert.equal(normaliseForGrounding('reduced preparation time by half'),
    normaliseForGrounding('reduced preparation  time\nby half'));

  // An em dash typed as a hyphen is the same quote.
  assert.ok(normaliseForGrounding(transcript).includes(normaliseForGrounding('students said-clearly-it helped')));
});

test('a fabricated quote still fails grounding after normalisation', () => {
  const transcript = 'We reduced preparation time by half.';
  assert.ok(!normaliseForGrounding(transcript).includes(normaliseForGrounding('we tripled our revenue')));
});
```

Add `normaliseForGrounding` to the import block from `../src/semantic.mjs`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/semantic.test.mjs`
Expected: FAIL — `normaliseForGrounding is not a function`

- [ ] **Step 3: Implement normalisation**

Replace `spanIsGrounded` in `src/semantic.mjs`:

```js
// A quoted span only counts as evidence if it is actually in the transcript.
// This is what stops a fluent model from inventing a supporting sentence.
//
// Normalisation runs on BOTH sides. Without it, a model that re-flows a quote
// across a line break, or types an em dash as a hyphen, has a CORRECT verdict
// discarded — a false negative that costs the student real credit silently.
// Case-insensitivity is kept for the same reason: case is a transcription
// artefact, not evidence of paraphrase.
export function normaliseForGrounding(value) {
  return String(value ?? '')
    .replace(/[‘’‛]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, '-')
    .replace(/[​-‍﻿]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

// Spans shorter than this match too easily to be evidence of anything: a
// four-character fragment appears in almost any transcript by chance, so it
// would ground a verdict without supporting it. Covered by
// "a span too short to be evidence never grounds".
export const MIN_SPAN_CHARS = 12;

function spanIsGrounded(span, transcript) {
  const needle = normaliseForGrounding(span);
  if (needle.length < MIN_SPAN_CHARS) return false;
  return normaliseForGrounding(transcript).includes(needle);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/semantic.test.mjs`
Expected: PASS, and every pre-existing grounding test still passes

- [ ] **Step 5: Add the short-span guard test**

```js
test('a span too short to be evidence never grounds', () => {
  const base = { criteria: [{ id: 'problem-clarity', label: 'Problem clarity', signals: [], score: 0, status: 'missing', missingSignals: [], excerpt: '' }] };
  const payload = { criteria: [{ id: 'problem-clarity', status: 'covered', span: 'students', missing: [] }] };

  // "students" is in the transcript, but it is 8 characters — too short to
  // support a criterion, so the verdict is discarded rather than credited.
  const result = applySemanticVerdicts(base, payload, 'Indonesian students prepare alone.');
  assert.equal(result.criteria[0].status, 'missing');
});
```

- [ ] **Step 6: Run the full gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/semantic.mjs test/semantic.test.mjs
git commit -m "Stop discarding correct quotes over whitespace and dashes

Grounding compared raw lowercased strings, so a model quoting across a
line break or normalising an em dash lost a verdict it had earned. The
minimum span length is now named and tested rather than a magic number."
```

---

## Task 3: Record which engine answered each criterion

When a span fails grounding, `:193` correctly drops that row to deterministic — but the response is still badged `mode: 'semantic'` overall. A result can claim "semantic" while individual criteria were cue-matched. That is an INV-4 boundary hidden in a UI label.

**Files:**
- Modify: `src/semantic.mjs:184-222`
- Test: `test/semantic.test.mjs`

**Interfaces:**
- Produces: every criterion object gains `engine: 'semantic' | 'deterministic'`. The result object gains `semanticCriteria: number` and `totalCriteria: number`.

- [ ] **Step 1: Write the failing test**

```js
test('each criterion reports which engine actually answered it', () => {
  const base = {
    criteria: [
      { id: 'a', label: 'A', signals: [], score: 0, status: 'missing', missingSignals: [], excerpt: '' },
      { id: 'b', label: 'B', signals: [], score: 0, status: 'missing', missingSignals: [], excerpt: '' },
    ],
  };
  const transcript = 'Indonesian students rehearse alone without any rubric to check against.';
  const payload = {
    criteria: [
      { id: 'a', status: 'covered', span: 'students rehearse alone without any rubric', missing: [] },
      { id: 'b', status: 'covered', span: 'we have already signed four universities', missing: [] },
    ],
  };

  const result = applySemanticVerdicts(base, payload, transcript);

  assert.equal(result.criteria[0].engine, 'semantic', 'a grounded verdict is semantic');
  assert.equal(result.criteria[1].engine, 'deterministic', 'an ungrounded verdict fell back');
  assert.equal(result.semanticCriteria, 1);
  assert.equal(result.totalCriteria, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/semantic.test.mjs`
Expected: FAIL — `expected 'semantic' but got undefined`

- [ ] **Step 3: Tag each criterion with its engine**

In `applySemanticVerdicts`, replace the three early-return points and the return object:

```js
  const criteria = base.criteria.map((criterion) => {
    const verdict = byId.get(criterion.id);
    // No verdict for this criterion: the deterministic result stands, and we
    // say so rather than letting the overall mode badge speak for it.
    if (!verdict || !STATUSES.has(verdict.status)) {
      return { ...criterion, engine: 'deterministic' };
    }

    const span = String(verdict.span ?? '').trim();
    const supported = verdict.status !== 'missing';
    if (supported) claimedSupport += 1;

    // INV-3: a supporting verdict without a real, quoted span is discarded.
    if (supported && !spanIsGrounded(span, transcript)) {
      return { ...criterion, engine: 'deterministic' };
    }
    if (supported) grounded += 1;
```

and inside the successful return object, add `engine: 'semantic',` alongside `score`.

Then, after the `claimedSupport > 0 && grounded === 0` guard, add:

```js
  const semanticCriteria = criteria.filter((item) => item.engine === 'semantic').length;
```

and include `semanticCriteria` and `totalCriteria: criteria.length` in the returned object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/semantic.test.mjs`
Expected: PASS

- [ ] **Step 5: Run the full gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add src/semantic.mjs test/semantic.test.mjs
git commit -m "Say which criteria the model actually judged

A response was badged semantic even when individual criteria had fallen
back to cue matching, so the badge claimed more than the run delivered.
Provenance is now per criterion (INV-2, INV-4)."
```

---

## Task 4: Show the engine per criterion in the review screen

The data from Task 3 is useless until a judge can see it. This is the visible half of the INV-4 fix.

**Files:**
- Modify: `src/app.mjs` (the evidence card renderer near `src/app.mjs:550`)
- Test: `scripts/browser-check.mjs`

**Interfaces:**
- Consumes: `criterion.engine` from Task 3

- [ ] **Step 1: Add the engine label to the evidence card**

In the function that builds each verdict card in `src/app.mjs`, after the existing evidence element is appended:

```js
  // INV-4: the overall mode badge cannot speak for a criterion that fell back.
  // textContent, never innerHTML: this sits beside user input (INV-5).
  if (criterion.engine === 'deterministic') {
    const provenance = document.createElement('p');
    provenance.className = 'evidence-provenance';
    provenance.textContent = 'Matched by cue matching, not semantic analysis.';
    card.append(provenance);
  }
```

- [ ] **Step 2: Style it as secondary, not alarming**

In `src/styles.css`, beside the existing evidence styles:

```css
/* A fallback is an honest disclosure, not an error. It should read as a
   footnote, never as a warning that undermines the verdict beside it. */
.evidence-provenance {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
```

- [ ] **Step 3: Add a browser check**

In `scripts/browser-check.mjs`, add a check that runs an analysis and asserts that when a criterion carries `engine: 'deterministic'`, the string `cue matching` is present in the review panel's text content.

- [ ] **Step 4: Run the browser check**

Run: `pnpm test:browser`
Expected: PASS, 15 checks

- [ ] **Step 5: Run the full gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add src/app.mjs src/styles.css scripts/browser-check.mjs
git commit -m "Show the reader which criteria fell back to cue matching

A disclosed boundary costs nothing; a discovered one costs the round."
```

---

## Task 5: Rubric import — the pure module

Turn a pasted scoring matrix into the existing `label | cues` line format. Emitting that format means `parseRubric`, `project.rubric`, and the entire data model stay untouched.

**Files:**
- Create: `src/rubric-import.mjs`
- Test: `test/rubric-import.test.mjs`

**Interfaces:**
- Consumes: `AnalysisError` from `src/analyzer.mjs`
- Produces:
  - `buildImportMessages(rubricText: string) => Array<{role, content}>`
  - `parseImportedRubric(payload: unknown) => string` — returns `label | cues` lines, throws `SemanticUnavailable` when invalid
  - `MAX_IMPORT_CHARS = 8000`, `MAX_CRITERIA = 20`

- [ ] **Step 1: Write the failing test**

Create `test/rubric-import.test.mjs`:

```js
// Rubric import is the hero moment: a judge pastes their own scoring matrix
// on stage. It must produce something usable or degrade to the manual editor
// with the raw text intact — it must never block starting a project.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRubric } from '../src/analyzer.mjs';
import { buildImportMessages, parseImportedRubric } from '../src/rubric-import.mjs';

test('a well-formed model response becomes rubric lines the parser accepts', () => {
  const payload = {
    criteria: [
      { label: 'Technical Execution', cues: ['prototype', 'architecture', 'works live'] },
      { label: 'Pitching and Q&A', cues: ['clarity', 'handles questions'] },
    ],
  };

  const text = parseImportedRubric(payload);
  assert.equal(text, 'Technical Execution | prototype, architecture, works live\nPitching and Q&A | clarity, handles questions');

  // The real contract: whatever we emit must survive the existing parser.
  const parsed = parseRubric(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].label, 'Technical Execution');
});

test('a response with no usable criteria is rejected rather than half-imported', () => {
  assert.throws(() => parseImportedRubric({ criteria: [] }), /no criteria/u);
  assert.throws(() => parseImportedRubric({}), /no criteria/u);
  assert.throws(() => parseImportedRubric({ criteria: [{ cues: ['x'] }] }), /no criteria/u);
});

test('the prompt forbids inventing criteria and names the source text', () => {
  const messages = buildImportMessages('Technical Execution 30%\nPitching 20%');
  const system = messages.find((message) => message.role === 'system').content;

  assert.match(system, /only.*criteria.*present/iu);
  assert.ok(messages.some((message) => message.content.includes('Technical Execution 30%')));
});

test('an oversized paste fails loudly instead of being truncated', () => {
  assert.throws(() => buildImportMessages('x'.repeat(9000)), /too long/u);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/rubric-import.test.mjs`
Expected: FAIL — cannot find module `../src/rubric-import.mjs`

- [ ] **Step 3: Implement the module**

Create `src/rubric-import.mjs`:

```js
// ============================================================================
//  Rubric import — turn a pasted scoring matrix into criteria.
//
//  The output is the SAME `label | cues` line format the manual editor and
//  parseRubric already use, so importing changes no data model and no storage
//  shape. Import is a convenience over typing, never a second source of truth.
//
//  Nothing is persisted here. The student confirms the parse before it is
//  saved, because the system must never silently guess what an evaluator meant.
// ============================================================================
import { AnalysisError } from './analyzer.mjs';

export const MAX_IMPORT_CHARS = 8000;
export const MAX_CRITERIA = 20;

export class ImportUnavailable extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ImportUnavailable';
  }
}

export function buildImportMessages(rubricText) {
  const source = String(rubricText ?? '').trim();
  if (!source) {
    throw new AnalysisError('empty_rubric', 'Paste the scoring matrix first.');
  }
  // INV-7: refuse loudly. Silently truncating would drop criteria the student
  // believes were imported — the worst possible failure for this feature.
  if (source.length > MAX_IMPORT_CHARS) {
    throw new AnalysisError('rubric_too_long', `That rubric is too long to import. Keep it under ${MAX_IMPORT_CHARS} characters.`);
  }

  return [
    {
      role: 'system',
      content: [
        'You convert an evaluator\'s scoring matrix into structured criteria.',
        'Return only criteria that are present in the source text. Never invent a criterion, and never merge two into one.',
        'For each criterion give a short label and 2 to 5 lowercase cue words a speaker would actually say to satisfy it.',
        'Respond with JSON only: {"criteria":[{"label":"...","cues":["...","..."]}]}',
      ].join(' '),
    },
    { role: 'user', content: source },
  ];
}

export function parseImportedRubric(payload) {
  const criteria = Array.isArray(payload?.criteria) ? payload.criteria : [];

  const lines = criteria
    .map((criterion) => {
      const label = String(criterion?.label ?? '').trim().replace(/\|/gu, '-');
      const cues = Array.isArray(criterion?.cues)
        ? criterion.cues.map((cue) => String(cue).trim().replace(/[|,]/gu, ' ')).filter(Boolean)
        : [];
      if (!label) return null;
      return cues.length > 0 ? `${label} | ${cues.join(', ')}` : label;
    })
    .filter(Boolean)
    .slice(0, MAX_CRITERIA);

  if (lines.length === 0) {
    throw new ImportUnavailable('the response contained no criteria');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/rubric-import.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/rubric-import.mjs test/rubric-import.test.mjs
git commit -m "Structure a pasted scoring matrix into rubric criteria

Emits the same label-pipe-cues format the manual editor already uses, so
import adds a convenience without adding a second data model."
```

---

## Task 6: Rubric import — the endpoint

**Files:**
- Create: `api/import-rubric.mjs`
- Modify: `src/semantic.mjs` (export `callGateway`)
- Test: `test/rubric-import.test.mjs`

**Interfaces:**
- Consumes: `callGateway({messages, apiKey, model, timeoutMs, fetchImpl})` from `src/semantic.mjs`, `buildImportMessages`, `parseImportedRubric`
- Produces: `importRubric({rubricText, apiKey, models, fetchImpl}) => {rubricText: string, mode: 'semantic'}`

- [ ] **Step 1: Export the gateway caller**

In `src/semantic.mjs`, change `async function callGateway(` to `export async function callGateway(`. It is already the shared transport; rubric import needs the same failover and timeout behaviour rather than a second implementation.

- [ ] **Step 2: Write the failing test**

Append to `test/rubric-import.test.mjs`:

```js
import { importRubric } from '../src/rubric-import.mjs';

const OK_RESPONSE = {
  ok: true,
  json: async () => ({ choices: [{ message: { content: '{"criteria":[{"label":"Technical Execution","cues":["prototype","works live"]}]}' } }] }),
};

test('import returns rubric lines when the model answers', async () => {
  const result = await importRubric({
    rubricText: 'Technical Execution 30%',
    apiKey: 'test-key-placeholder',
    models: ['test/mock-model'],
    fetchImpl: async () => OK_RESPONSE,
  });

  assert.equal(result.rubricText, 'Technical Execution | prototype, works live');
});

test('import fails loudly rather than returning an empty rubric', async () => {
  await assert.rejects(
    () => importRubric({
      rubricText: 'Technical Execution 30%',
      apiKey: 'test-key-placeholder',
      models: ['test/mock-model'],
      fetchImpl: async () => ({ ok: false, status: 500 }),
    }),
    /could not be imported/u,
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/rubric-import.test.mjs`
Expected: FAIL — `importRubric is not a function`

- [ ] **Step 4: Implement `importRubric`**

Append to `src/rubric-import.mjs`:

```js
import { DEFAULT_TIMEOUT_MS, MODEL_CHAIN, callGateway, extractJsonPayload, selectApiCredential } from './semantic.mjs';

// One structuring pass per vendor, cheapest first. Import runs once per
// project, so a failure costs a retry — never a broken session. On total
// failure the caller falls back to the manual editor with the raw paste
// intact, which is why this throws instead of returning a partial rubric.
export async function importRubric({
  rubricText,
  apiKey = selectApiCredential(),
  models = MODEL_CHAIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const messages = buildImportMessages(rubricText);
  if (!apiKey) throw new ImportUnavailable('no credentials');

  for (const model of models) {
    try {
      const text = await callGateway({ messages, apiKey, model, timeoutMs, fetchImpl });
      return { rubricText: parseImportedRubric(extractJsonPayload(text)), mode: 'semantic' };
    } catch {
      // Try the next vendor. Availability comes from provider diversity.
    }
  }

  throw new ImportUnavailable('that rubric could not be imported automatically');
}
```

Export the existing private `extractJson` from `src/semantic.mjs` as `extractJsonPayload`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/rubric-import.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 6: Create the HTTP handler**

Create `api/import-rubric.mjs` mirroring `api/analyze.mjs` exactly: same `readJsonBody`, same `send`, same `MAX_BODY_BYTES`, POST-only, `AnalysisError` → 400, `ImportUnavailable` → 422 with the message `"Import unavailable — edit the criteria manually instead."`, anything else → 500.

- [ ] **Step 7: Run the full gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 8: Commit**

```bash
git add api/import-rubric.mjs src/rubric-import.mjs src/semantic.mjs test/rubric-import.test.mjs
git commit -m "Add the rubric import endpoint

Reuses the gateway transport and failover chain rather than growing a
second one. A failed import degrades to the manual editor with the paste
intact; it never blocks starting a project."
```

---

## Task 7: Rubric import — the interface

The hero moment: paste the finals scoring matrix on stage, get criteria, confirm, analyse.

**Files:**
- Modify: `index.html` (rubric view, near `index.html:362`)
- Modify: `src/app.mjs` (rubric editor section, near `src/app.mjs:775-796`)
- Test: `scripts/browser-check.mjs`

**Interfaces:**
- Consumes: `POST /api/import-rubric` → `{rubricText}`; existing `renderRubricEditor()` and `rubricRow()`

- [ ] **Step 1: Add the import panel markup**

In `index.html`, inside the rubric view above `<div class="rubric-list" id="rubricEditor">`:

```html
<details class="rubric-import" id="rubricImport">
  <summary>Import from a scoring matrix</summary>
  <p class="rubric-import-lede">Paste an evaluator's published criteria. You confirm every criterion before it is saved.</p>
  <textarea id="rubricImportInput" rows="6" aria-label="Paste the scoring matrix"></textarea>
  <button type="button" id="rubricImportButton">Structure these criteria</button>
  <p class="rubric-import-status" id="rubricImportStatus" role="status"></p>
</details>
```

- [ ] **Step 2: Wire the import button**

In `src/app.mjs`, add to the elements map and register a handler:

```js
async function importRubricFromMatrix() {
  const source = elements.rubricImportInput.value.trim();
  if (!source) return;

  elements.rubricImportStatus.textContent = 'Structuring…';
  elements.rubricImportButton.disabled = true;
  try {
    const response = await fetch('/api/import-rubric', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rubricText: source }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? 'Import failed.');

    // Render into the editor UNSAVED. The student confirms before it persists:
    // the system never silently guesses what an evaluator meant.
    const criteria = parseRubric(result.rubricText);
    elements.rubricEditor.replaceChildren(...criteria.map((criterion, index) => rubricRow(
      { label: criterion.label, signals: criterion.signals },
      index,
    )));
    elements.rubricImportStatus.textContent = `${criteria.length} criteria ready — review them, then save.`;
  } catch (error) {
    // INV-8: import failing must never block the manual path.
    elements.rubricImportStatus.textContent = `${error.message} Edit the criteria manually below.`;
  } finally {
    elements.rubricImportButton.disabled = false;
  }
}
```

Every string above is set with `textContent` (INV-5).

- [ ] **Step 3: Add a browser check for the hero path**

In `scripts/browser-check.mjs`, add a `rubric-import` check: stub `/api/import-rubric` to return two criteria, click the button, assert two `.rubric-row` elements appear and that nothing was persisted until Save is clicked.

- [ ] **Step 4: Run the browser check**

Run: `pnpm test:browser`
Expected: PASS, 16 checks

- [ ] **Step 5: Run the full gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add index.html src/app.mjs src/styles.css scripts/browser-check.mjs
git commit -m "Let a judge paste their own scoring matrix

This is the demo the pitch is built around. Imported criteria land in the
editor unsaved so the student confirms them, and a failed import falls
back to manual editing with the paste intact."
```

---

## Task 8: Extend the demo gate to cover fallback and import

The gate currently proves the deterministic path. It does not prove the thing most likely to break on stage: the fallback.

**Files:**
- Modify: `scripts/demo-gate.mjs`

- [ ] **Step 1: Add a semantic-mode step**

Stub `/api/analyze` to return a valid semantic result; assert the review renders and the mode badge reads semantic.

- [ ] **Step 2: Add a fallback step**

Stub `/api/analyze` to return HTTP 500; assert the review still renders every verdict, the badge does **not** read semantic, and the console stays empty. **The gate must fail if fallback does not engage.**

- [ ] **Step 3: Add an import-failure step**

Stub `/api/import-rubric` to return 422; assert the manual editor is still usable and the pasted text is not lost.

- [ ] **Step 4: Run the gate**

Run: `pnpm demo`
Expected: PASS, 12 steps, empty console array

- [ ] **Step 5: Run the full gate**

Run: `pnpm check`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add scripts/demo-gate.mjs
git commit -m "Prove the fallback, not just the happy path

The gate walked the deterministic path only, so the degradation the whole
demo depends on was never exercised."
```

---

## Self-Review

**Spec coverage.** Tasks 1–4 cover every confirmed defect in `2026-08-12-validation-report.md` §3 (P0-1 through P0-4; the withdrawn "partial fabrication" item correctly has no task). Tasks 5–7 cover A6 rubric import from `2026-08-10-innovation-week.md`. Task 8 covers B6.

**Not covered here, deliberately.** B3 kiosk reset, B4 empty/error states, B5 mobile pass are frontend-track items with no dependency on this work — they belong in the frontend plan. The Next.js migration is a separate plan; nothing here blocks or is blocked by it. Filling `docs/finals-readiness.json` is evidence work, not implementation.

**Type consistency.** `engine` is `'semantic' | 'deterministic'` in Tasks 3 and 4. `normaliseForGrounding` and `MIN_SPAN_CHARS` are defined in Task 2 and used in Task 2 only. `parseImportedRubric` returns a `string` in Task 5 and is consumed as a string in Task 6. `importRubric` returns `{rubricText, mode}` in Task 6 and is consumed as `result.rubricText` in Task 7. `callGateway` and `extractJsonPayload` are exported in Task 6 before use.

**Ordering.** Tasks 1–4 are independent of 5–8 and can run in parallel by two people. Task 6 depends on Task 5; Task 7 depends on Task 6; Task 8 depends on Task 7.
