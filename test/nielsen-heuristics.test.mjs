// ============================================================================
//  NIELSEN'S TEN USABILITY HEURISTICS — enforced where they are checkable.
//
//  A heuristic list on a slide is a claim. This file turns the ten into
//  assertions about the shipped interface, so "we applied Nielsen" is something
//  a judge can run rather than something we say.
//
//  Not every heuristic reduces to a grep, and pretending otherwise would be its
//  own kind of overclaiming (INV-2). Where a heuristic needs a rendered page —
//  focus order, live-region announcements, real error recovery — the check
//  lives in e2e/production-ui/ and is NAMED here so the coverage is legible
//  rather than implied. Where it cannot be automated at all, this file says so.
// ============================================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const PRACTICE = read('apps/web/components/practice-room.tsx');
const PROGRESS = read('apps/web/components/progress-view.tsx');
const RUBRIC = read('apps/web/components/rubric-editor.tsx');
const FRAME = read('apps/web/components/workspace-frame.tsx');
const ENTRY = read('apps/web/components/entry-gate.tsx');
const LANDING = read('apps/web/components/production-shell.tsx');
const WORKSPACE = read('apps/web/app/(workspace)/workspace/page.tsx');
const STUDIO = read('apps/web/components/multimodal-studio.tsx');
const MULTIMODAL_REVIEW = read('apps/web/components/multimodal-review.tsx');
const TOAST = read('apps/web/components/toast.tsx');
const STYLES = read('src/styles.css');
const SHELL_STYLES = read('apps/web/app/shell.css');
const SURFACES = [PRACTICE, PROGRESS, RUBRIC, FRAME, STUDIO].join('\n');

// As user-facing copy moves into the message catalogues (issue #36), a
// heuristic asserted by grepping a component for its English sentence stops
// finding it. The property being asserted has not moved — the user can still
// always leave — so the assertion follows the copy rather than being dropped.
// Checking every locale is the stricter version of what was there before: an
// escape hatch that exists only in English is not an escape hatch for the
// audience this product is for.
const CATALOGUES = ['id', 'en'].map(
  (locale) => JSON.parse(read(`apps/web/messages/${locale}.json`)),
);

function everyLocaleTranslates(namespace, key, message) {
  for (const [index, catalogue] of CATALOGUES.entries()) {
    const value = catalogue[namespace]?.[key];
    assert.ok(
      typeof value === 'string' && value.trim().length > 0,
      `${message} (missing ${namespace}.${key} in ${['id', 'en'][index]}.json)`,
    );
  }
}

// ---------------------------------------------------------------------------
//  1. Visibility of system status
// ---------------------------------------------------------------------------
test('H-1 every asynchronous action reports that it is running', () => {
  // A button that does nothing visible for two seconds reads as broken. Each
  // long action names its own state rather than sharing one global spinner.
  assert.match(PRACTICE, /aria-busy=\{busy/u, 'the review action must expose a busy state');
  assert.match(PRACTICE, /Reviewing each criterion…/u, 'the busy state must say what is running');
  assert.match(PRACTICE, /Checking only this answer…/u, 'the defense action must name its own work');
  // The words moved to the catalogues with the rest of this screen (#36). The
  // property is unchanged and now checked in every locale, because a loading
  // state that only exists in English leaves the default-locale reader looking
  // at a blank panel with no explanation.
  assert.match(PROGRESS, /t\('checkingSynced'\)/u, 'history loading must be visible');
  everyLocaleTranslates('progressView', 'checkingSynced', 'the loading state must be named in every locale');
});

test('H-1 status messages are announced, not only drawn', () => {
  const liveRegions = SURFACES.match(/role="status"|aria-live=/gu) ?? [];
  assert.ok(
    liveRegions.length >= 6,
    `expected the workspace to announce status in at least six places, found ${liveRegions.length}`,
  );
  assert.match(PRACTICE, /aria-current=\{index === current \? 'step' : undefined\}/u,
    'the practice stepper must announce the current step, not signal it with a class alone');
});

// ---------------------------------------------------------------------------
//  2. Match between the system and the real world
// ---------------------------------------------------------------------------
test('H-2 the interface speaks the user\'s language, not the schema\'s', () => {
  // Field and table names leaking into visible copy is the usual failure.
  const jargon = /\b(nullable|varchar|uuid|foreign key|payload|serializ|blob url|contractVersion is)\b/iu;
  for (const [name, source] of Object.entries({ PRACTICE, PROGRESS, RUBRIC })) {
    const visibleText = [...source.matchAll(/>([^<>{}]{12,})</gu)].map((match) => match[1]).join(' ');
    assert.doesNotMatch(visibleText, jargon, `${name} shows implementation vocabulary to the user`);
  }
});

// ---------------------------------------------------------------------------
//  3. User control and freedom
// ---------------------------------------------------------------------------
test('H-3 every stage of the practice flow has a marked exit', () => {
  // The heuristic is "the user can always leave", not "there is a button named
  // Exit session" — that dedicated link was removed on 13 August because the
  // persistent sidebar already leaves from every stage. So the property is
  // asserted where it actually lives: a nav that is present throughout.
  for (const destination of ['/workspace', '/practice', '/rubric', '/progress']) {
    assert.ok(FRAME.includes(`href: '${destination}'`), `the persistent nav must reach ${destination}`);
  }
  assert.match(PRACTICE, /Revise transcript/u, 'review must be able to return to the attempt');
  assert.match(PRACTICE, /Back to attempt review/u, 'the Q&A drill must be able to go back');
  assert.match(STUDIO, /t\('finishAssemble'\)/u, 'a running capture must be stoppable by the user');
  everyLocaleTranslates('studio', 'finishAssemble', 'the stop control must be labelled in every locale');
  // The link itself is still asserted in the component; only its words moved.
  assert.match(ENTRY, /className="entry-back" href="\/"/u, 'the entry decision must link back to the landing page');
  everyLocaleTranslates('entryGate', 'back', 'the entry decision must offer a visible return to the landing page');
  // Structure in the component, words in the catalogues. The brand link is
  // rendered twice — sidebar and mobile header — so both survive a viewport
  // that hides one of them.
  assert.ok(
    (FRAME.match(/className="brand" href="\/"/gu) ?? []).length >= 2,
    'workspace chrome must always return to the landing page, on both layouts',
  );
  everyLocaleTranslates('workspaceFrame', 'brandHome', 'the return link must be labelled in every locale');
});

test('H-3 the attempt step opens on writing, and capture is a choice the user makes', () => {
  // The step used to open with the camera panel already mounted, so "start an
  // attempt" and "hand over a camera and a microphone" were one decision. They
  // are two now: writing is the default, live capture is a labelled switch, and
  // the studio is not on the page — not merely idle — until it is chosen.
  assert.match(
    PRACTICE,
    /useState<CaptureMode>\('write'\)/u,
    'the attempt step must default to the typed transcript',
  );
  assert.match(
    PRACTICE,
    /\{captureMode === 'record' && <MultimodalStudio/u,
    'the capture panel must be absent until live capture is chosen',
  );
  for (const label of ['Write or paste', 'Record live']) {
    assert.ok(PRACTICE.includes(label), `both capture routes must be named on screen: ${label}`);
  }
  // Choosing capture is not consenting to any signal within it. The checklist
  // states that in the words the user reads, before anything is requested.
  assert.match(
    STUDIO,
    /t\('chooseObserve'\)/u,
    'live capture must present its observation checklist before Start',
  );
  // Consent copy is the one thing that must never be readable in only one
  // language: a checklist a user cannot read is not informed consent.
  everyLocaleTranslates('studio', 'chooseObserve', 'the consent checklist must be readable in every locale');
  everyLocaleTranslates('studio', 'consentBoundary', 'what each signal does must be stated in every locale');
  assert.match(
    STUDIO,
    /every signal starts off/u,
    'the checklist must say that nothing is enabled by default',
  );
});

test('H-3 an irreversible action says so before it is taken', () => {
  // The evidence Yes/No writes a human evaluation label and then locks. The
  // right fix is not a fake undo — the label records what a person judged at a
  // moment — it is to say so BEFORE the click, where it changes the decision.
  assert.match(
    PRACTICE,
    /recorded once as your own evaluation label, and cannot be changed/u,
    'the finality of an evidence label must be stated before the buttons',
  );
  const boundaryIndex = PRACTICE.indexOf('cannot be changed afterwards');
  const buttonsIndex = PRACTICE.indexOf('production-confirm');
  assert.ok(
    boundaryIndex > 0 && boundaryIndex < buttonsIndex,
    'the warning must appear before the control it warns about',
  );
});

// ---------------------------------------------------------------------------
//  4. Consistency and standards
// ---------------------------------------------------------------------------
test('H-4 consistency is enforced by the design system, not by memory', () => {
  // Deliberately a pointer, not a copy. The type-scale, colour, and spacing
  // rules are 55 assertions in test/design-system.test.mjs; restating one of
  // them here produced a second, worse version that rejected `font-size: 0`
  // — the sanctioned way to collapse a label to its icon at a breakpoint.
  // Two rules for one decision is how they drift apart.
  const designSystem = read('test/design-system.test.mjs');
  for (const rule of [
    'every component font-size comes from the type scale',
    'component styles use semantic tokens, never primitives',
    'spacing comes from the spacing scale',
  ]) {
    assert.ok(designSystem.includes(rule), `the design system no longer enforces "${rule}"`);
  }
  assert.ok(STYLES.length > 0 && SHELL_STYLES.length > 0, 'both component stylesheets must exist to be checked');
  assert.match(TOAST, /variant/u, 'system feedback must come from one shared component');
});

test('H-4 an action keeps its name through the flow', () => {
  // "Save rubric" must not produce "Rubric updated". The vocabulary of an
  // interface is its signposting.
  // The vocabulary claim survives translation: the confirmation must echo the
  // verb on the button, in whatever language both are written in. Checked as a
  // relationship between two catalogue entries rather than as English text.
  assert.match(RUBRIC, /t\('saveRubric'\)/u);
  assert.match(RUBRIC, /title: t\('saved'\)/u, 'the confirmation must echo the verb on the button');
  for (const locale of ['id', 'en']) {
    const entries = JSON.parse(read(`apps/web/messages/${locale}.json`)).rubricEditor;
    const verb = entries.saveRubric.split(/\s+/u)[0].toLocaleLowerCase(locale);
    assert.ok(
      entries.saved.toLocaleLowerCase(locale).includes(verb)
        || entries.saveRubric.toLocaleLowerCase(locale).includes(
          entries.saved.split(/\s+/u)[0].toLocaleLowerCase(locale),
        ),
      `${locale}: "${entries.saved}" must echo the action "${entries.saveRubric}"`,
    );
  }
});

// ---------------------------------------------------------------------------
//  5. Error prevention
// ---------------------------------------------------------------------------
test('H-5 inputs constrain what can go wrong before it goes wrong', () => {
  assert.match(PRACTICE, /type="number" min="1" max="3600"/u, 'duration must be bounded at the input');
  assert.match(
    PRACTICE,
    /accept="\.txt,\.md,\.markdown,\.json/u,
    'the file picker must offer only the types the endpoint accepts',
  );
  assert.match(PRACTICE, /disabled=\{!sourceFile \|\| sourceBusy \|\| sourceDocuments\.length >= 3\}/u,
    'the upload action must be unavailable when it would fail');
});

test('H-5 a capture cannot start without an explicit, separate consent', () => {
  // Four independent choices, none implying another (product invariant).
  for (const consent of ['captureCamera', 'captureAcoustic', 'captureDictation', 'saveReplay']) {
    assert.ok(STUDIO.includes(consent), `capture consent ${consent} must be its own decision`);
  }
});

// ---------------------------------------------------------------------------
//  6. Recognition rather than recall
// ---------------------------------------------------------------------------
test('H-6 the whole rubric is visible without remembering it', () => {
  // Six criteria run several screens because the quoted span is deliberately
  // the largest text on the page. The map indexes them so "how am I doing"
  // never costs a scroll in both directions.
  assert.match(PRACTICE, /className="evidence-map"/u, 'the criteria must be visible at a glance');
  assert.match(PRACTICE, /href=\{`#evidence-\$\{criterion\.id\}`\}/u,
    'each map cell must lead to the criterion it names');
  assert.match(STYLES, /\.evidence-map-mark/u, 'each cell must carry its state, not just its name');
});

test('H-6 a chart explains its own encoding in place', () => {
  const charts = read('apps/web/components/delivery-charts.tsx');
  assert.match(charts, /The dashed line marks/u, 'a reference line must be named where it is drawn');
  assert.match(charts, /reading-legend/u, 'the legend must live beside the chart');
});

// ---------------------------------------------------------------------------
//  7. Flexibility and efficiency of use
// ---------------------------------------------------------------------------
test('H-7 the workspace serves a returning user as well as a first-time one', () => {
  assert.match(FRAME, /skip-link|Skip to workspace content/u, 'a keyboard user must be able to skip the chrome');
  assert.match(PROGRESS, /project-switcher/u, 'a returning user with several projects must be able to choose one');
  assert.match(
    PRACTICE,
    /href=\{`\/rubric\$\{projectQuery\}`\}/u,
    'the selected project rubric must be reachable without losing its identity',
  );
});

// ---------------------------------------------------------------------------
//  8. Aesthetic and minimalist design
// ---------------------------------------------------------------------------
test('H-8 the comparison view shows what changed, not everything', () => {
  assert.match(
    PROGRESS,
    /direction !== 'unchanged'/u,
    'the diff must not render both sides of an identical quote for every criterion',
  );
  assert.match(PROGRESS, /attempt-diff-held/u, 'what held must still be named, briefly');
});

test('H-8 a control with one option is not shown at all', () => {
  assert.match(
    PROGRESS,
    /projects\.length > 1 && <div className="project-switcher"/u,
    'a dropdown holding a single option promises a choice the product cannot offer',
  );
  assert.match(
    WORKSPACE,
    /projects\.length > 1 && <div className="project-switcher"/u,
    'the workspace project chooser must also disappear when there is nothing to choose',
  );
});

// ---------------------------------------------------------------------------
//  9. Help users recognise, diagnose, and recover from errors
// ---------------------------------------------------------------------------
test('H-9 an error says what happened and what to do next', () => {
  assert.match(RUBRIC, /t\('keepOne'\)/u, 'a rejected save must name the fix, not just the failure');
  everyLocaleTranslates('rubricEditor', 'keepOne', 'the fix for a rejected save must exist in every locale');
  assert.match(
    PRACTICE,
    /Your saved project could not be restored just now/u,
    'a failed recovery must be reported rather than silently downgrading the session',
  );
  assert.match(TOAST, /negative|warning|positive/u, 'errors must be distinguishable from confirmations');
});

test('H-9 an error is never signalled by colour alone', () => {
  // Every toast variant ships a title and a message; the colour is the third
  // signal, not the only one.
  assert.match(TOAST, /title/u);
  assert.match(TOAST, /message/u);
  // An error interrupts; a confirmation does not. The role is chosen per
  // variant rather than fixed, which is the distinction assistive tech acts on.
  assert.match(
    TOAST,
    /role=\{toast\.variant === 'negative' \? 'alert' : 'status'\}/u,
    'a failure must announce as an alert and a confirmation as a status',
  );
});

// ---------------------------------------------------------------------------
//  10. Help and documentation
// ---------------------------------------------------------------------------
test('H-10 the limits of the analysis are documented in the product, not a manual', () => {
  assert.match(FRAME, /<Link className="nav-item" href="\/">/u,
    'the public landing page must be reachable from every workspace page');
  everyLocaleTranslates('workspaceFrame', 'navLanding', 'the landing-page nav item must be labelled in every locale');
  assert.doesNotMatch(FRAME, /How it works/u, 'workspace navigation must not add a redundant help destination');
  assert.doesNotMatch(LANDING, /How it works/u, 'the landing page must not restore the removed explanatory section');
  assert.match(PRACTICE, /not confidence or speaking ability/u, 'the review must state what it is not');
  // INV-6: a number may describe one rehearsal, never the speaker, and it must
  // say so beside itself. Checked in every locale — a boundary that exists only
  // in English does not bound anything for the reader it was written for.
  assert.match(
    MULTIMODAL_REVIEW,
    /t\('oneAttemptBoundary'\)/u,
    'the summary figure must carry its own boundary beside it',
  );
  everyLocaleTranslates('multimodalReview', 'oneAttemptBoundary',
    'the summary figure boundary must exist in every locale');
});

// ---------------------------------------------------------------------------
//  What this file deliberately does NOT claim to check.
// ---------------------------------------------------------------------------
test('the heuristics needing a rendered page are covered in the browser suite', () => {
  // Naming these keeps the coverage honest: a static check cannot see focus
  // order, live-region timing, or whether a switch actually refetched.
  const browserChecks = {
    'e2e/production-ui/golden-path.spec.ts': [
      'expectVisibleControlsHitTest', // H-7: every visible control is reachable and hit-testable
    ],
    'e2e/production-ui/project-switcher.spec.ts': [
      'switching changes the history shown', // H-1/H-4: the page reports the project it is showing
      'a signed-out visitor asks for no project list', // H-9: no failed request on a working page
    ],
    'e2e/production-ui/progress-charts.spec.ts': [
      'never draws a chart it has no history for', // H-8: an empty state instead of an empty axis
    ],
    'e2e/production-ui/navigation-history.spec.ts': [
      'predictable browser-back path', // H-3: route choices unwind in the order the user made them
      'How it works', // H-8: the removed explanatory detour stays absent at mobile size
    ],
  };
  for (const [file, needles] of Object.entries(browserChecks)) {
    const source = read(file);
    for (const needle of needles) {
      assert.ok(source.includes(needle), `${file} no longer covers "${needle}"`);
    }
  }
});
