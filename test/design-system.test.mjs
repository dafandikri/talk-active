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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const TOKENS = read('src/tokens.css');
const STYLES = read('src/styles.css');
const NEXT_SHELL_STYLES = read('apps/web/app/shell.css');
const APPAREL_MARK = read('src/assets/macaw-mark-white.svg');
const PRODUCT_MARK = readFileSync(join(ROOT, 'src/assets/LOGO.png'));
const DASHBOARD_MARK = readFileSync(join(ROOT, 'src/assets/LOGO-dashboard.png'));
const TAGLINE_LOCKUP = readFileSync(join(ROOT, 'src/assets/LOGO & TAGLINE.png'));
// The vanilla HTML was deleted on 12 August. These two names now stand for the
// React surfaces that replaced them, so the markup-level assertions below keep
// checking the same product decisions rather than being quietly dropped.
const readAll = (relatives) => relatives.map((relative) => read(relative)).join('\n');
const WORKSPACE_FRAME = read('apps/web/components/workspace-frame.tsx');
const INDEX = readAll([
  'apps/web/components/workspace-frame.tsx',
  'apps/web/components/practice-room.tsx',
  'apps/web/components/rubric-editor.tsx',
  'apps/web/components/progress-view.tsx',
  'apps/web/components/account-panel.tsx',
  'apps/web/components/entry-gate.tsx',
]);
const BRIEF = readAll(['apps/web/components/production-shell.tsx']);

function pngMetadata(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', 'asset must be a PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colourType: buffer[25],
  };
}

function rgbaPixel(buffer, x, y) {
  const metadata = pngMetadata(buffer);
  assert.equal(buffer[24], 8, 'dashboard PNG must remain 8-bit');
  assert.equal(metadata.colourType, 6, 'dashboard PNG must remain RGBA');
  assert.equal(buffer[28], 0, 'dashboard PNG must remain non-interlaced');

  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }

  const source = inflateSync(Buffer.concat(idat));
  const stride = metadata.width * 4;
  const decoded = Buffer.alloc(metadata.height * stride);
  const paeth = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
      ? left
      : aboveDistance <= upperLeftDistance ? above : upperLeft;
  };

  for (let row = 0; row < metadata.height; row += 1) {
    const filter = source[row * (stride + 1)];
    const sourceStart = row * (stride + 1) + 1;
    const targetStart = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = source[sourceStart + column];
      const left = column >= 4 ? decoded[targetStart + column - 4] : 0;
      const above = row > 0 ? decoded[targetStart + column - stride] : 0;
      const upperLeft = row > 0 && column >= 4 ? decoded[targetStart + column - stride - 4] : 0;
      const predictor = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
      assert.notEqual(predictor, undefined, `unsupported PNG filter ${filter}`);
      decoded[targetStart + column] = (raw + predictor) & 0xff;
    }
  }

  const pixel = y * stride + x * 4;
  return [...decoded.subarray(pixel, pixel + 4)];
}

// Comments carry the reasoning, and the reasoning mentions the very literals
// these tests ban. Strip them before linting so documentation is not a defect.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const STYLES_CODE = stripComments(STYLES);
const COMPONENT_STYLES_CODE = `${STYLES_CODE}\n${stripComments(NEXT_SHELL_STYLES)}`;
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
test('every component font-size comes from the type scale', () => {
  const offenders = linesMatching(COMPONENT_STYLES_CODE, /font-size\s*:/u).filter((entry) => {
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
test('component styles contain no raw colour literals', () => {
  const offenders = linesMatching(COMPONENT_STYLES_CODE, /#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/iu);
  assert.equal(
    offenders.length, 0,
    report(offenders, 'Colour must come from a semantic token in tokens.css. Raw hex/rgba is how ~40 one-off colours accumulated.'),
  );
});

test('component styles use semantic tokens, never primitives', () => {
  // A component asking for `--blue-600` knows too much. It should ask for
  // `--evidence` or `--accent-sky`, so the palette can move without touching components.
  // --step-* and --space-* are scales, not palettes: components are supposed to
  // reach for those directly. Colour ramps are the ones that must stay hidden.
  const offenders = linesMatching(COMPONENT_STYLES_CODE, /var\(\s*--(mono|blue|leaf|sun|orange)-|var\(\s*--paper\s*\)/u);
  assert.equal(
    offenders.length, 0,
    report(offenders, 'Components may not reference colour primitives (--mono-*, --blue-*, --leaf-*, --sun-*, --orange-*, --paper). Use a semantic role token so the palette can move without touching components.'),
  );
});

test('spacing comes from the spacing scale', () => {
  const offenders = linesMatching(COMPONENT_STYLES_CODE, /(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:/u)
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
  for (const block of COMPONENT_STYLES_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
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
  for (const block of COMPONENT_STYLES_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
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
  for (const block of COMPONENT_STYLES_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
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

test('the captain-supplied PNG marks remain the product source of truth', () => {
  assert.deepEqual(pngMetadata(PRODUCT_MARK), { width: 823, height: 630, colourType: 6 });
  assert.deepEqual(pngMetadata(DASHBOARD_MARK), { width: 823, height: 630, colourType: 6 });
  assert.deepEqual(pngMetadata(TAGLINE_LOCKUP), { width: 1019, height: 1005, colourType: 6 });
  assert.ok(PRODUCT_MARK.length < 100_000, 'icon-only logo should stay below 100 KB');
  assert.ok(DASHBOARD_MARK.length < 100_000, 'transparent dashboard logo should stay below 100 KB');
  assert.ok(TAGLINE_LOCKUP.length < 150_000, 'tagline lockup should stay below 150 KB');
  assert.deepEqual(rgbaPixel(DASHBOARD_MARK, 0, 0), [0, 0, 0, 0], 'outer canvas must be transparent');
  assert.deepEqual(rgbaPixel(DASHBOARD_MARK, 500, 400), [255, 255, 255, 255], 'speech-bubble interior must stay white');
  assert.deepEqual(rgbaPixel(DASHBOARD_MARK, 250, 250), rgbaPixel(PRODUCT_MARK, 250, 250), 'bird artwork must match the supplied PNG');
});

test('the full-body dimensional mascot is local, visible, and motion-safe', () => {
  const relative = 'src/assets/macaw-mascot-3d.webp';
  assert.ok(existsSync(join(ROOT, relative)), 'the dashboard mascot asset is missing');
  assert.ok(statSync(join(ROOT, relative)).size < 200_000, 'the dashboard mascot should stay below 200 KB');
  assert.match(read('apps/web/app/(workspace)/workspace/page.tsx'), /mascot\/kato-macaw-reading\.svg/u);
  assert.match(STYLES, /@keyframes mascot-greet/u);
  assert.match(STYLES, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(
    STYLES,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.focus-mascot\s*\{\s*animation:\s*none !important;\s*\}/u,
  );
});

test('the apparel mark remains a one-ink warm-white speaking macaw', () => {
  assert.match(APPAREL_MARK, /white macaw perched inside a white speech-bubble outline/u);
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
  for (const block of COMPONENT_STYLES_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
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
  const offenders = linesMatching(COMPONENT_STYLES_CODE, /font-family\s*:/u).filter((entry) => {
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
  ['--accent-sun-strong', '--accent-sun-wash', 4.5, 'the filler-word chip on the delivery panel'],
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
// The vanilla cascade-order test lived here. The next test asserts the same
// property against apps/web/app/layout.tsx, which is the shell that now ships.
test('the Next.js shell imports the frozen visual system directly and in cascade order', () => {
  const layout = read('apps/web/app/layout.tsx');
  const tokensAt = layout.indexOf("src/tokens.css");
  const stylesAt = layout.indexOf("src/styles.css");
  const landingAt = layout.indexOf("src/landing.css");

  assert.ok(tokensAt !== -1, 'the production shell must import the existing tokens.css');
  assert.ok(stylesAt !== -1, 'the production shell must import the existing styles.css');
  assert.ok(landingAt !== -1, 'the production shell must import the existing landing.css');
  assert.ok(
    tokensAt < stylesAt && stylesAt < landingAt,
    'the production shell must preserve tokens → product → landing cascade order',
  );
});

test('dashboard home carries the approved character-led outlined material', () => {
  assert.match(
    STYLES_CODE,
    /\.home-header\s*\{[^}]*border:\s*2px solid var\(--text-primary\);[^}]*box-shadow:\s*var\(--space-1\) var\(--space-1\) 0 var\(--accent-orange\);/su,
  );
  assert.match(
    STYLES_CODE,
    /\.focus-card\s*\{[^}]*border:\s*2px solid var\(--text-primary\);[^}]*box-shadow:\s*var\(--space-1\) var\(--space-1\) 0 var\(--accent-sky\);/su,
  );
  for (const selector of ['next-session', 'rubric-health', 'recent-section']) {
    assert.match(STYLES_CODE, new RegExp(`\\.${selector}\\s*\\{[^}]*border:\\s*2px solid var\\(--text-primary\\);[^}]*box-shadow:`, 'su'));
  }
  assert.match(read('apps/web/app/(workspace)/workspace/page.tsx'), /kato-macaw-reading\.svg/u);
});

test('the Talk-Active lockup is consistent across product and landing surfaces', () => {
  assert.ok((INDEX.match(/className="brand-wordmark"/gu) ?? []).length >= 1,
    'the workspace surfaces must carry the Talk-Active lockup');
  assert.ok((BRIEF.match(/className="brand-wordmark"/gu) ?? []).length >= 1,
    'the landing surface must carry the Talk-Active lockup');
  assert.match(BRIEF, /brand\/talk-active-logo\.svg/u, 'the landing must draw the mark from the committed brand asset');
  assert.match(INDEX, /Talk-<(?:strong|span) className="brand-wordmark-accent">Active<\/(?:strong|span)>/u,
    'the accent must stay on "Active" so the lockup reads identically on every surface');
  // Light workflow headers use the vector lockup; the dark sidebar must use
  // the supplied RGBA dashboard mark whose speech-bubble interior is white.
  assert.match(INDEX, /brand\/talk-active-logo\.svg/u);
  assert.match(WORKSPACE_FRAME, /assets\/LOGO-dashboard\.png/u,
    'the dark workspace shell must use the dashboard mark with its opaque white interior');
  assert.doesNotMatch(WORKSPACE_FRAME, /brand\/talk-active-logo\.svg/u,
    'the transparent vector mark makes the speech-bubble interior disappear on the dark sidebar');
});

test('workflow views keep the character system restrained and evidence-safe', () => {
  // practice, progress, and account each carry exactly one. The rubric editor dropped its
  // banner on 13 August so the criteria list starts at the top of the page.
  assert.equal((INDEX.match(/className="workflow-mark"/gu) ?? []).length, 3,
    'each workflow view that keeps a banner carries exactly one workflow mark');
  assert.match(STYLES_CODE, /\.workflow-header\s*\{[^}]*background:\s*var\(--accent-sun-wash\);[^}]*border:\s*2px solid var\(--text-primary\);[^}]*box-shadow:\s*none;/su);
  assert.match(STYLES_CODE, /\.workflow-mark\s*\{[^}]*object-fit:\s*contain;[^}]*box-shadow:\s*none;/su);
  assert.doesNotMatch(STYLES_CODE, /\.workflow-mark\s*\{[^}]*(?:background|border):/su);
  for (const selector of ['setup-form', 'setup-rubric', 'capture-panel', 'rubric-editor-card', 'progress-chart-card', 'history-card']) {
    assert.match(STYLES_CODE, new RegExp(`(?:\\.${selector}[^{}]*)\\{[^}]*border:\\s*2px solid var\\(--text-primary\\);`, 'su'));
  }
  assert.doesNotMatch(STYLES_CODE, /#(?:practice|rubric|progress)View \.workflow-(?:header|mark)[^{]*\{[^}]*box-shadow:[^}]*var\(--accent-/su);
});

test('every semantic token is documented with its intent', () => {
  // A token nobody can explain is a token somebody will misuse.
  const doc = read('docs/design/DESIGN-SYSTEM.md');
  const undocumented = ['--evidence', '--absence', '--brand', '--font-voice', '--step-evidence']
    .filter((name) => !doc.includes(name));
  assert.deepEqual(undocumented, [], `these tokens carry the product thesis and must be explained in the design system doc: ${undocumented.join(', ')}`);
});

// Kato is the only illustration on the dashboard, so he is either carrying
// information or taking up space. These pin him to the first.
const WORKSPACE_PAGE = read('apps/web/app/(workspace)/workspace/page.tsx');

test('the mascot pose is chosen by the state of the work, not fixed', () => {
  for (const pose of ['kato-macaw-alert', 'kato-macaw-questioning', 'kato-macaw-reading']) {
    assert.ok(WORKSPACE_PAGE.includes(pose), `${pose} is drawn but never used, so a state has no face`);
  }
  for (const state of ['waiting', 'supported', 'gap']) {
    assert.match(WORKSPACE_PAGE, new RegExp(`state: '${state}'`, 'u'), `no pose reports the ${state} state`);
  }
  assert.match(
    WORKSPACE_PAGE,
    /data-coach=\{coach\.state\}/u,
    'the state must reach the DOM, or styling cannot respond to it',
  );
});

test('swapping pose cannot shift the layout', () => {
  // The three drawings are 392x489, 544x535, and 454x624. A single hardcoded
  // size would be wrong for at least two of them and would move the card.
  assert.match(WORKSPACE_PAGE, /width=\{coach\.art\.width\}/u);
  assert.match(WORKSPACE_PAGE, /height=\{coach\.art\.height\}/u);
  assert.ok(
    !/className="focus-mascot"[^>]*width="\d+"/u.test(WORKSPACE_PAGE),
    'a literal width brings back the layout shift these attributes exist to prevent',
  );
});

test('the mascot reads as two planes at different depths', () => {
  // Depth comes from parallax between the figure and the plate behind it. One
  // plane moving alone reads as a sticker sliding around.
  assert.match(STYLES, /\.focus-coach\s*\{[^}]*perspective:/u, 'the container needs a perspective for any Z to matter');
  assert.match(STYLES, /@keyframes mascot-greet[^}]*\{[\s\S]*?translate3d[\s\S]*?rotateY/u);
  assert.match(STYLES, /@keyframes coach-plate[\s\S]*?translateZ\(-90px\)/u);
  assert.match(STYLES, /\.focus-coach::before[\s\S]*?animation:\s*coach-plate/u);
});

test('reduced motion stops the movement and keeps the meaning', () => {
  const reduced = STYLES.slice(STYLES.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.focus-mascot\s*\{\s*animation:\s*none !important;\s*\}/u);
  assert.match(reduced, /\.focus-coach::before\s*\{\s*animation:\s*none !important;\s*\}/u);
  // The pose itself is chosen in the component, so it survives this media query
  // by construction. That is the point: motion is decoration, pose is content.
});
