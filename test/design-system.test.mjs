// ============================================================================
//  DESIGN SYSTEM — deterministic enforcement.
//
//  A design system is a constraint, not a palette. The stylesheet this replaced
//  declared 123 custom properties and then bypassed every one of them: 24
//  distinct pixel font sizes between 8px and 40px, ~40 hex colours most used
//  exactly once, 15 ad-hoc rgba() values, and a `font-family: Inter` that had
//  no @font-face, no font file, and no chance of loading under CSP
//  `style-src 'self'`.
//
//  Declaring tokens did nothing. What makes a system real is that the raw value
//  becomes UNAVAILABLE. That is this file's job.
//
//  Each test below maps to a decision recorded in docs/design/DESIGN-SYSTEM.md.
//  If you need to break one, change the decision there first, in a commit,
//  with the team. Do not weaken the test to go green (AGENTS.md, rule 3).
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const TOKENS = read('src/tokens.css');
const STYLES = read('src/styles.css');
const APPAREL_MARK = read('src/assets/cockatoo-mark-white.svg');

// Comments carry the reasoning, and the reasoning mentions the very literals
// these tests ban. Strip them before linting so documentation is not a defect.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const STYLES_CODE = stripComments(STYLES);
const TOKENS_CODE = stripComments(TOKENS);

// Report the offending line, not the whole file. A gate that dumps 500 lines at
// 2am is a gate nobody reads.
function linesMatching(css, pattern) {
  return css
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => pattern.test(entry.line));
}

function report(offenders, rule) {
  const shown = offenders.slice(0, 8).map((o) => `    line ${o.number}: ${o.line.slice(0, 96)}`);
  const more = offenders.length > 8 ? `\n    …and ${offenders.length - 8} more` : '';
  return `${rule}\n${shown.join('\n')}${more}`;
}

// ---------------------------------------------------------------------------
//  Colour resolution, so contrast is checked against the tokens that actually
//  ship rather than against numbers copied into a comment.
// ---------------------------------------------------------------------------
function declarationsIn(css, scopePattern) {
  const scope = css.match(scopePattern);
  assert.ok(scope, `expected a ${scopePattern} block in tokens.css`);
  const map = new Map();
  for (const [, name, value] of scope[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)) {
    map.set(name, value.trim());
  }
  return map;
}

const ROOT_TOKENS = (() => {
  const map = new Map();
  for (const [, name, value] of TOKENS_CODE.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)) {
    if (!map.has(name)) map.set(name, value.trim()); // first (:root) definition wins
  }
  return map;
})();

const BOOTH_TOKENS = declarationsIn(TOKENS_CODE, /\[data-surface="booth"\]\s*\{([\s\S]*?)\n\}/u);

function resolve(name, overrides = new Map(), depth = 0) {
  assert.ok(depth < 12, `token ${name} appears to reference itself`);
  const raw = overrides.get(name) ?? ROOT_TOKENS.get(name);
  assert.ok(raw, `token ${name} is not defined in tokens.css`);
  const ref = raw.match(/^var\((--[\w-]+)\)$/u);
  return ref ? resolve(ref[1], overrides, depth + 1) : raw;
}

function channelToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const clean = hex.trim().replace('#', '');
  assert.ok(/^[0-9a-f]{6}$/iu.test(clean), `expected a 6-digit hex colour, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
//  1. The scale is the only source of type size.
// ---------------------------------------------------------------------------
test('every font-size in styles.css comes from the type scale', () => {
  const offenders = linesMatching(STYLES_CODE, /font-size\s*:/u).filter((entry) => {
    const values = [...entry.line.matchAll(/font-size\s*:\s*([^;}]+)/gu)].map((m) => m[1].trim());
    // `font-size: 0` is a layout technique (collapsing a label to icon-only at
    // a breakpoint), not a type-scale choice.
    return values.some((value) => !/^(var\(--step-[\w-]+\)|inherit|0)$/u.test(value));
  });
  assert.equal(
    offenders.length, 0,
    report(offenders, 'font-size must be var(--step-*), inherit, or 0. Raw sizes are how 24 near-identical sizes accumulated.'),
  );
});

test('no two type steps are closer than 20% apart', () => {
  const steps = [...ROOT_TOKENS.entries()]
    .filter(([name]) => /^--step-\d$/u.test(name))
    .map(([name, value]) => ({ name, px: parseFloat(value) * 16 }))
    .sort((a, b) => a.px - b.px);

  assert.ok(steps.length >= 6, 'expected at least 6 numbered type steps');
  for (let i = 1; i < steps.length; i += 1) {
    const ratio = steps[i].px / steps[i - 1].px;
    assert.ok(
      ratio >= 1.2,
      `${steps[i - 1].name} (${steps[i - 1].px}px) and ${steps[i].name} (${steps[i].px}px) are only ${ratio.toFixed(2)}x apart. `
      + 'Steps that close cannot be told apart, so nobody can choose between them correctly.',
    );
  }
});

test('the evidence step outranks the page title — evidence is the hero', () => {
  // The design decision "evidence is the hero" has to live somewhere a
  // reviewer cannot forget it. Here is somewhere.
  const evidence = resolve('--step-evidence');
  const max = parseFloat(evidence.match(/clamp\([^,]+,[^,]+,\s*([\d.]+)rem/u)?.[1] ?? '0');
  const pageTitle = parseFloat(resolve('--step-4'));
  assert.ok(
    max > pageTitle,
    `--step-evidence tops out at ${max}rem but --step-4 (page title) is ${pageTitle}rem. `
    + 'The quoted evidence must be able to outrank the page title.',
  );
});

// ---------------------------------------------------------------------------
//  2. Colour only enters through semantic tokens.
// ---------------------------------------------------------------------------
test('styles.css contains no raw colour literals', () => {
  const offenders = linesMatching(STYLES_CODE, /#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/iu);
  assert.equal(
    offenders.length, 0,
    report(offenders, 'Colour must come from a semantic token in tokens.css. Raw hex/rgba is how ~40 one-off colours accumulated.'),
  );
});

test('styles.css uses semantic tokens, never primitives', () => {
  // A component asking for `--blue-600` knows too much. It should ask for
  // `--evidence` or `--accent-sky`, so the palette can move without touching components.
  // --step-* and --space-* are scales, not palettes: components are supposed to
  // reach for those directly. Colour ramps are the ones that must stay hidden.
  const offenders = linesMatching(STYLES_CODE, /var\(\s*--(mono|blue|leaf|sun|orange)-|var\(\s*--paper\s*\)/u);
  assert.equal(
    offenders.length, 0,
    report(offenders, 'Components may not reference colour primitives (--mono-*, --blue-*, --leaf-*, --sun-*, --orange-*, --paper). Use a semantic role token so the palette can move without touching components.'),
  );
});

test('spacing comes from the spacing scale', () => {
  const offenders = linesMatching(STYLES_CODE, /(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:/u)
    .filter((entry) => {
      const decls = [...entry.line.matchAll(/(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*([^;}]+)/gu)];
      return decls.some(([, value]) => /\b\d*\.?\d+px\b/u.test(value));
    });
  assert.equal(
    offenders.length, 0,
    report(offenders, 'padding/margin/gap must use var(--space-*), 0, auto, %, or a clamp(). Raw px is how 93 distinct spacing values accumulated.'),
  );
});

// ---------------------------------------------------------------------------
//  3. Amethyst means evidence. That is the whole differentiator.
// ---------------------------------------------------------------------------
// A matched cue IS evidence — `.signal-chip.matched` is a citation in miniature,
// so it belongs to the reserved hue by the same logic as a quoted span.
const EVIDENCE_CONTEXT = /evidence|quote|blockquote|transcript|verdict|citation|cited|matched|voice/iu;

test('the evidence colour is reserved for evidence', () => {
  // INV-3: every verdict cites the evidence behind it. If evidence blue also means
  // "primary button" then it means nothing, and the citation stops reading as
  // special the moment a visitor sees it twice on unrelated things.
  const offenders = [];
  for (const block of STYLES_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const [, selector, body] = block;
    if (!/var\(\s*--evidence/u.test(body)) continue;
    if (!EVIDENCE_CONTEXT.test(selector)) {
      offenders.push({ number: 0, line: `${selector.trim().slice(0, 70)} { … --evidence … }` });
    }
  }
  assert.equal(
    offenders.length, 0,
    report(offenders, 'var(--evidence-*) may only be used on evidence/quote/verdict selectors. Reserving the hue is what makes the citation legible as the differentiator.'),
  );
});

test('the voice typeface is reserved for the user\'s own words', () => {
  // The serif is a semantic signal: "these are YOUR words, not ours." The old
  // stylesheet sprayed Georgia across stat numbers, avatars and icon circles,
  // which destroyed the signal.
  const offenders = [];
  for (const block of STYLES_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const [, selector, body] = block;
    if (!/var\(\s*--font-voice\s*\)/u.test(body)) continue;
    if (!EVIDENCE_CONTEXT.test(selector)) {
      offenders.push({ number: 0, line: `${selector.trim().slice(0, 70)} { … --font-voice … }` });
    }
  }
  assert.equal(
    offenders.length, 0,
    report(offenders, 'var(--font-voice) may only style quoted user speech. Elsewhere it is decoration and the signal dies.'),
  );
});

test('no verdict is coloured as a pass or a fail', () => {
  // INV-2 forbids claiming an ability score; INV-4 requires that limit to stay
  // visible. Green/red is the universal grammar of grading, so a red criterion
  // silently reasserts the score we promised not to give. Absence of evidence
  // is neutral: it is the next thing to rehearse, not a mark.
  const offenders = [];
  for (const block of STYLES_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const [, selector, body] = block;
    if (!/var\(\s*--(danger|caution)/u.test(body)) continue;
    // A destructive control ("remove this criterion") is an ACTION, and red is
    // the right colour for one. The ban is on colouring a criterion's RESULT.
    const isAction = /remove|delete|discard|button|:hover|is-recording|record|error/iu.test(selector);
    if (isAction) continue;
    if (EVIDENCE_CONTEXT.test(selector) || /criterion|criteria|signal|coverage|score/iu.test(selector)) {
      offenders.push({ number: 0, line: `${selector.trim().slice(0, 70)} { … danger/caution … }` });
    }
  }
  assert.equal(
    offenders.length, 0,
    report(offenders, '--danger/--caution are for SYSTEM state (failed analysis, degraded gateway), never for a criterion verdict. Use --evidence / --absence.'),
  );
});

test('the captain-supplied speaking-bird palette remains exact', () => {
  const supplied = {
    '--blue-600': '#1b7ea6',
    '--leaf-600': '#2f5923',
    '--leaf-500': '#3a731f',
    '--sun-500': '#f2b90c',
    '--orange-500': '#bf6b04',
  };
  for (const [name, expected] of Object.entries(supplied)) {
    assert.equal(ROOT_TOKENS.get(name), expected, `${name} drifted from the supplied bird palette`);
  }
});

test('the apparel mark remains a one-ink warm-white speaking bird', () => {
  assert.match(APPAREL_MARK, /full-body speaking bird inside a white speech-bubble outline/u);
  assert.match(APPAREL_MARK, /#fffef9/iu, 'the visible apparel artwork must use warm white ink');

  // Black and pure white are permitted only inside the SVG mask: they remove
  // the eye and wing line from the warm-white print and never render as ink.
  const visibleArtwork = APPAREL_MARK.replace(/<defs>[\s\S]*?<\/defs>/u, '');
  const visibleColours = [...visibleArtwork.matchAll(/(?:fill|stroke)="(#[0-9a-f]{3,8})"/giu)]
    .map((match) => match[1].toLowerCase());
  assert.deepEqual(
    [...new Set(visibleColours)],
    ['#fffef9'],
    'the apparel mark must remain one visible warm-white ink; fabric supplies every other colour',
  );
});

test('green structure never colours a verdict or score', () => {
  const offenders = [];
  for (const block of STYLES_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const [, selector, body] = block;
    if (!/var\(\s*--(accent-leaf|brand)/u.test(body)) continue;
    if (/evidence|criterion-result|coverage|score|session-status|verdict/iu.test(selector)) {
      offenders.push({ number: 0, line: `${selector.trim().slice(0, 70)} { … green structure … }` });
    }
  }
  assert.equal(
    offenders.length, 0,
    report(offenders, 'Leaf green is structure and setup context only. Using it on verdicts or scores would imply a pass state.'),
  );
});

// ---------------------------------------------------------------------------
//  4. Typography we actually ship.
// ---------------------------------------------------------------------------
test('every named typeface is a platform font or is shipped with @font-face', () => {
  // The old stylesheet asked for `Inter` with no font file and no @font-face,
  // under a CSP that blocks Google Fonts. It never loaded once, so the app
  // rendered in a different face on every machine — including, silently, the
  // booth laptop. Naming a font we do not ship is INV-2 applied to type.
  const declared = new Set();
  for (const [, stack] of TOKENS_CODE.matchAll(/--font-[\w-]+\s*:\s*([^;]+);/gu)) {
    for (const family of stack.split(',')) {
      const name = family.trim().replace(/^["']|["']$/gu, '');
      if (name && !name.startsWith('var(')) declared.add(name);
    }
  }

  const PLATFORM_FONTS = new Set([
    'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif',
    'ui-serif', 'serif', 'ui-monospace', 'monospace',
    'Segoe UI', 'Roboto', 'Helvetica Neue', 'Helvetica', 'Arial',
    'Georgia', 'Iowan Old Style', 'Times New Roman', 'Times',
  ]);

  const shipped = new Set(
    [...TOKENS_CODE.matchAll(/@font-face[^}]*font-family\s*:\s*["']?([^;"']+)/gu)].map((m) => m[1].trim()),
  );

  const phantom = [...declared].filter((name) => !PLATFORM_FONTS.has(name) && !shipped.has(name));
  assert.deepEqual(
    phantom, [],
    `these typefaces are named but never load — either ship them with @font-face or stop naming them: ${phantom.join(', ')}`,
  );
});

test('font-family in components resolves to a role token', () => {
  const offenders = linesMatching(STYLES_CODE, /font-family\s*:/u).filter((entry) => {
    const values = [...entry.line.matchAll(/font-family\s*:\s*([^;}]+)/gu)].map((m) => m[1].trim());
    return values.some((value) => !/^(var\(--font-(ui|voice)\)|inherit)$/u.test(value));
  });
  assert.equal(
    offenders.length, 0,
    report(offenders, 'font-family must be var(--font-ui), var(--font-voice), or inherit.'),
  );
});

// ---------------------------------------------------------------------------
//  5. Contrast, computed from the tokens that ship.
// ---------------------------------------------------------------------------
const CONTRAST_PAIRS = [
  // [foreground, background, minimum, why]
  ['--text-primary', '--surface', 4.5, 'body copy on a card'],
  ['--text-primary', '--canvas', 4.5, 'body copy on the page ground'],
  ['--text-secondary', '--surface', 4.5, 'secondary copy'],
  ['--text-muted', '--surface', 4.5, 'muted copy still has to be readable'],
  ['--text-muted', '--canvas', 4.5, 'muted copy on the page ground'],
  ['--brand', '--surface', 4.5, 'brand used as text or an icon'],
  ['--brand', '--brand-wash', 4.5, 'brand text inside its own wash'],
  ['--brand-contrast', '--brand', 4.5, 'label on a primary button'],
  ['--evidence', '--surface', 4.5, 'THE citation — must never be marginal'],
  ['--evidence-strong', '--evidence-wash', 4.5, 'citation label inside its highlight'],
  ['--text-primary', '--evidence-wash', 4.5, 'the quoted span itself, on its highlight'],
  ['--evidence', '--evidence-wash', 3.0, 'the 4px rule down the citation card — UI, not text'],
  ['--absence', '--surface', 3.0, 'the "no cue matched" marker is UI, not text'],
  ['--text-on-inverse', '--surface-inverse', 4.5, 'copy on the dark hero panel'],
  // These four exist because a screenshot caught what the suite did not: chips
  // on the dark sidebar were given a light-theme wash, which made the active
  // project name and the profile label invisible. Untested pairs are where
  // this class of bug lives.
  ['--text-on-inverse', '--inverse-raised', 4.5, 'the active project chip in the sidebar'],
  ['--text-on-inverse-muted', '--inverse-raised', 4.5, 'the profile chip subtitle'],
  ['--inverse-accent', '--surface-inverse', 3.0, 'accents and gauge fill on the dark ground'],
  ['--surface-inverse', '--inverse-accent', 4.5, 'the avatar glyph on its accent disc'],
  ['--danger', '--danger-wash', 4.5, 'a failed analysis must be readable (INV-7)'],
  ['--caution', '--caution-wash', 4.5, 'the degraded-mode banner (INV-4)'],
];

for (const [fg, bg, minimum, why] of CONTRAST_PAIRS) {
  test(`contrast: ${fg} on ${bg} — ${why}`, () => {
    const ratio = contrast(resolve(fg), resolve(bg));
    assert.ok(
      ratio >= minimum,
      `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below the ${minimum}:1 required. ${why}.`,
    );
  });
}

const BOOTH_PAIRS = [
  ['--text-primary', '--canvas', 4.5, 'booth headline at 2 metres'],
  ['--text-muted', '--canvas', 4.5, 'booth supporting line'],
  ['--evidence', '--canvas', 4.5, 'the citation is what pulls people over'],
  ['--evidence', '--surface', 4.5, 'citation on a booth card'],
  ['--brand', '--canvas', 4.5, 'booth brand furniture'],
  ['--absence', '--canvas', 3.0, 'booth absence marker'],
  ['--danger', '--danger-wash', 4.5, 'a failure on the booth screen stays readable and stays dark'],
  ['--caution', '--caution-wash', 4.5, 'degraded-mode notice on the booth screen'],
];

for (const [fg, bg, minimum, why] of BOOTH_PAIRS) {
  test(`contrast (booth): ${fg} on ${bg} — ${why}`, () => {
    const ratio = contrast(resolve(fg, BOOTH_TOKENS), resolve(bg, BOOTH_TOKENS));
    assert.ok(
      ratio >= minimum,
      `booth ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${minimum}:1. ${why}.`,
    );
  });
}

// Hue angle, because luminance contrast is the wrong question here. Two colours
// can have identical luminance and be obviously different (red and green), so a
// contrast ratio cannot tell you whether brand green and evidence blue read as separate colours
// or two. Hue separation can.
function hueAngle(hex) {
  const clean = hex.trim().replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return null; // achromatic: no hue to compare
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return ((hue * 60) + 360) % 360;
}

function hueSeparation(a, b) {
  const [ha, hb] = [hueAngle(a), hueAngle(b)];
  if (ha === null || hb === null) return 360; // grey vs colour is never confusable
  const diff = Math.abs(ha - hb);
  return Math.min(diff, 360 - diff);
}

test('evidence and brand read as two colours, not one', () => {
  // The reserved-hue idea is the whole differentiator: blue means "this is
  // quoted from your transcript" and nothing else. If it reads as the brand
  // colour under exhibition lighting, the idea silently dies and the
  // citation stops standing out. 18° is the floor; the palette ships ~28°.
  for (const [label, overrides] of [['light', new Map()], ['booth', BOOTH_TOKENS]]) {
    const separation = hueSeparation(resolve('--evidence', overrides), resolve('--brand', overrides));
    assert.ok(
      separation >= 18,
      `${label}: --evidence and --brand are only ${separation.toFixed(1)}° apart in hue. `
      + 'Reserving blue for citations only works if it is visibly not brand green.',
    );
  }
});

// ---------------------------------------------------------------------------
//  6. The system is wired up and documented.
// ---------------------------------------------------------------------------
test('tokens.css is loaded before styles.css', () => {
  const html = read('index.html');
  const tokensAt = html.indexOf('tokens.css');
  const stylesAt = html.indexOf('styles.css');
  assert.ok(tokensAt !== -1, 'index.html must load src/tokens.css');
  assert.ok(stylesAt !== -1, 'index.html must load src/styles.css');
  assert.ok(tokensAt < stylesAt, 'tokens.css must be linked before styles.css or the cascade resolves tokens too late');
});

test('every semantic token is documented with its intent', () => {
  // A token nobody can explain is a token somebody will misuse.
  const doc = read('docs/design/DESIGN-SYSTEM.md');
  const undocumented = ['--evidence', '--absence', '--brand', '--font-voice', '--step-evidence']
    .filter((name) => !doc.includes(name));
  assert.deepEqual(undocumented, [], `these tokens carry the product thesis and must be explained in the design system doc: ${undocumented.join(', ')}`);
});
