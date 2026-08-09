#!/usr/bin/env node
// ============================================================================
//  Sprint board generator.
//
//  Writes one richly-described GitHub issue per task in
//  docs/specs/2026-08-10-innovation-week.md. Every issue is self-contained: a
//  teammate should be able to pick it up and start without reading anything
//  else, and should know exactly which competition points it defends.
//
//    node scripts/seed-issues.mjs --dry-run    # print the first body, create nothing
//    node scripts/seed-issues.mjs              # create or update every issue
//
//  Idempotent: an issue whose title already exists is UPDATED, not duplicated.
//  Requires an authenticated GitHub CLI (`gh auth login`).
// ============================================================================
import { execFileSync } from 'node:child_process';

const REPO_URL = 'https://github.com/dafandikri/talk-active';
const SPEC_URL = `${REPO_URL}/blob/sprint/innovation-week/docs/specs/2026-08-10-innovation-week.md`;

/** @type {{id:string,title:string,track:string,priority:string,why:string,points:string,steps:string[],done:string[],files:string[]}[]} */
const TASKS = [
  {
    id: 'A1', track: 'track:A', priority: 'demo-critical',
    title: 'Wire /api/analyze to the AI Gateway',
    points: 'Technical Execution 10 — "tech stack and software architecture are robust and secure"',
    why: 'Everything else in Track A depends on one authenticated call working. The gateway credential must never reach the browser, so analysis runs server-side.',
    steps: [
      'Get an AI Gateway key: Vercel dashboard → project → AI Gateway. Every team gets $5/month free.',
      'Add `AI_GATEWAY_API_KEY` in Vercel project settings for Production, Preview and Development.',
      'Run `vercel env pull .env.local` so local dev picks it up.',
      'Verify: `curl -X POST localhost:4173/api/analyze -H "Content-Type: application/json" -d \'{"transcript":"...","rubricText":"Problem | evidence","durationSeconds":30}\'`',
      'The response should come back with `"mode":"semantic"` instead of `"deterministic"`.',
    ],
    done: [
      '`mode` is `semantic` when the key is present',
      '`mode` falls back to `deterministic` when the key is removed, with no error shown to the user',
      'The key appears nowhere in the client bundle (`grep -r AI_GATEWAY src/ index.html` is empty)',
      '`pnpm check` green',
    ],
    files: ['`api/analyze.mjs`', '`src/semantic.mjs`'],
  },
  {
    id: 'A2', track: 'track:A', priority: 'demo-critical',
    title: 'Tune the semantic evidence-mapping prompt',
    points: 'Innovation & Uniqueness 5 — "avoids standard open-source clones with unique logic"',
    why: 'The prompt is where the differentiator is enforced. The model must quote the transcript verbatim for any criterion it marks supported; a fabricated quote is rejected in code by `applySemanticVerdicts`.',
    steps: [
      'Read the current prompt in `buildMessages()`.',
      'Test it against at least 5 real transcripts and 3 different rubrics.',
      'Watch for: invented quotes, criteria the model silently skips, and over-generous "covered" verdicts.',
      'Tighten wording until grounding failures are rare. Do NOT relax the code-side grounding check to compensate.',
    ],
    done: [
      'On 5 sample transcripts, at least 80% of supported verdicts pass the grounding check',
      'No verdict is ever returned with a quote absent from the transcript',
      'Tests in `test/semantic.test.mjs` still pass',
    ],
    files: ['`src/semantic.mjs`', '`test/semantic.test.mjs`'],
  },
  {
    id: 'A3', track: 'track:A', priority: 'demo-critical',
    title: 'Harden the deterministic fallback path',
    points: 'Technical Execution 10 — "functions smoothly without critical bugs during the live demo"',
    why: 'This is the single mitigation that stops a dead API from ending the pitch on stage. It already works; this task is about proving it under every failure mode we can invent.',
    steps: [
      'Add tests for: 500 from gateway, malformed JSON, empty completion, network refused, slow response past the timeout.',
      'Confirm each returns a usable result with `mode: "deterministic"` and a `degradedReason`.',
      'Confirm the analysis endpoint NEVER throws to the client for an AI-side reason.',
    ],
    done: [
      'Every failure mode above has a test',
      'No AI failure produces a 500; only invalid user input produces a 400',
      '`pnpm check` green',
    ],
    files: ['`src/semantic.mjs`', '`test/semantic.test.mjs`', '`api/analyze.mjs`'],
  },
  {
    id: 'A4', track: 'track:A', priority: 'demo-critical',
    title: 'Call /api/analyze from the client with a visible mode badge',
    points: 'Design & UX 5 · Technical Execution 10',
    why: 'The user must be able to see which engine answered. An invisible degradation is a lie by omission, and INV-2 forbids implying capability we do not have at that moment.',
    steps: [
      'In `src/app.mjs`, replace the direct `analyzeSpeech()` call with a `fetch("/api/analyze")`.',
      'Keep the local `analyzeSpeech()` as the client-side fallback if the request itself fails.',
      'Render a small badge on the review screen: "semantic" or "offline".',
      'Show a spinner while the request is in flight — never a frozen screen (see B4).',
    ],
    done: [
      'Toggling the server key swaps engines with no layout change',
      'Badge reads `semantic` or `offline` and is legible at 2m on the demo screen',
      'A failed fetch still produces a full review, client-side',
      '`pnpm demo` green',
    ],
    files: ['`src/app.mjs`', '`index.html`', '`src/styles.css`'],
  },
  {
    id: 'A5', track: 'track:A', priority: 'p1',
    title: 'Cache analysis responses by transcript hash',
    points: 'Interactive Demo 15 — "demonstrates core features smoothly"',
    why: 'Two reasons: cost against the $5/month free tier, and an instant replay of the stage demo if we need to run it twice.',
    steps: [
      'The in-memory cache in `api/analyze.mjs` already keys on sha256(duration + rubric + transcript).',
      'Verify a repeat request returns `cached: true` in well under 100ms.',
      'Confirm degraded results are NOT cached, so one blip does not pin us to deterministic mode.',
    ],
    done: [
      'Second identical analysis returns `cached: true` in <100ms',
      'A deterministic result is never cached',
    ],
    files: ['`api/analyze.mjs`'],
  },
  {
    id: 'A6', track: 'track:A', priority: 'demo-critical',
    title: 'Rubric import: paste a scoring matrix, get structured criteria',
    points: 'Innovation & Uniqueness 5 · Solution Alignment 5',
    why: 'THIS IS THE HERO MOMENT. On stage we paste the finals scoring matrix from the guidebook and it becomes a rubric in seconds. Without this, the pitch has no wow.',
    steps: [
      'Add `POST /api/import-rubric` taking raw pasted text.',
      'Prompt the model to return `[{label, requiredEvidence[]}]`.',
      'Render the parsed criteria for the user to EDIT and CONFIRM before saving — never save silently (that is the "system never guesses what an evaluator meant" promise in the proposal).',
      'Test with the actual finals scoring matrix from the guidebook, pages 20-21.',
    ],
    done: [
      'Pasting the guidebook finals matrix yields at least 5 criteria with sensible evidence cues',
      'The user can edit any criterion before saving',
      'Import failure falls back to the manual rubric editor with a clear message',
      'Rehearsed end to end in under 30 seconds',
    ],
    files: ['`api/import-rubric.mjs`', '`src/app.mjs`', '`index.html`'],
  },
  {
    id: 'B1', track: 'track:B', priority: 'demo-critical',
    title: 'Make the deployment publicly reachable for the exhibition',
    points: 'Interactive Demo 15 — "the working prototype is easily accessible and ready for visitors/judges to try on-site"',
    why: 'RIGHT NOW A VISITOR CANNOT OPEN THE APP. `middleware.js` enforces HTTP Basic Auth on every path and `vercel.json` sets `noindex`. This is the cheapest 15 points on the board and it is currently scoring zero.',
    steps: [
      'Decide: remove Basic Auth entirely for the exhibition build, or gate only a private admin path.',
      'If removing: delete or neuter `middleware.js`, and drop `X-Robots-Tag: noindex` from `vercel.json`.',
      'Redeploy and confirm from a phone on mobile data (not team wifi) with no credentials.',
      'Keep the Content-Security-Policy headers — those stay.',
    ],
    done: [
      'A stranger opens the URL on their own phone and completes one practice session',
      'No credential prompt anywhere',
      'CSP and other security headers still present',
    ],
    files: ['`middleware.js`', '`vercel.json`'],
  },
  {
    id: 'B2', track: 'track:B', priority: 'p1',
    title: 'QR code to the live URL, printed for the booth',
    points: 'Interactive Demo 15 · Booth & Visual 10',
    why: 'Visitors will not type a URL. A QR code is the difference between "they saw a screen" and "they used the product", which is literally what the criterion asks for.',
    steps: [
      'Generate a QR pointing at the production URL (depends on B1).',
      'Print large enough to scan from 1m. Put it on the booth backdrop AND on the one-pager (C4).',
      'Test from three different phones, including one Android and one iPhone.',
    ],
    done: ['Scanned successfully from three different phones', 'Readable from 1m', 'Printed and at the booth'],
    files: ['booth materials'],
  },
  {
    id: 'B3', track: 'track:B', priority: 'demo-critical',
    title: 'Kiosk reset between visitors',
    points: 'Interactive Demo 15 — "ready for visitors/judges to try"',
    why: 'After one visitor finishes, the next sees their leftover session. Without a reset, the booth degrades over the morning into a confusing mess.',
    steps: [
      'Add a reset control that clears `talkactive.workspace.v1` and reseeds the demo projects.',
      'Put it somewhere the team can reach fast but a visitor will not hit by accident.',
      'Cover it in `scripts/demo-gate.mjs`.',
    ],
    done: ['Reset restores the seed workspace in under 1s', 'Covered by the demo gate', '`pnpm demo` green'],
    files: ['`src/app.mjs`', '`index.html`', '`scripts/demo-gate.mjs`'],
  },
  {
    id: 'B4', track: 'track:B', priority: 'p1',
    title: 'Empty, error and loading states for every view',
    points: 'Design & UX 5 · Technical Execution 10',
    why: 'A semantic analysis call takes seconds. Without a loading state the app looks frozen, and a frozen app in front of a judge reads as a critical bug.',
    steps: [
      'Inventory every view: workspace, rubric, practice setup, attempt, review, defence, progress.',
      'For each: what shows while loading, on error, and with no data yet?',
      'Add a spinner or skeleton for the analysis request specifically.',
      'Never leave a blank panel reachable.',
    ],
    done: ['No blank panel is reachable by any click path', 'The analysis request shows progress within 200ms', 'Errors are readable and suggest a next action'],
    files: ['`src/app.mjs`', '`index.html`', '`src/styles.css`'],
  },
  {
    id: 'B5', track: 'track:B', priority: 'demo-critical',
    title: 'Mobile pass at 390px across the full judge path',
    points: 'Interactive Demo 15 · Design & UX 5',
    why: 'Booth visitors will use their own phones via the QR code. If the phone experience is broken, the 15-point "ready to try on-site" criterion collapses.',
    steps: [
      'Walk the full path at 390px: home → practice → attempt → review → defend → save → progress.',
      'Fix overflow, tap targets under 44px, and text under 14px.',
      'Extend the demo gate to run the whole path at 390px, not just the home view.',
    ],
    done: ['Full path completes at 390px with zero horizontal overflow', 'Zero console errors on mobile', 'Demo gate covers the mobile path'],
    files: ['`src/styles.css`', '`scripts/demo-gate.mjs`'],
  },
  {
    id: 'B6', track: 'track:B', priority: 'demo-critical',
    title: 'Extend the demo gate to cover semantic mode and fallback',
    points: 'Technical Execution 10',
    why: 'The gate currently proves the deterministic path. It must also prove that fallback actually engages when the API dies, because that is the mitigation the whole live demo rests on.',
    steps: [
      'Add a gate step that stubs `/api/analyze` to return 500 and asserts the UI still completes a review.',
      'Add a step asserting the mode badge renders.',
      'Add the kiosk reset from B3.',
    ],
    done: ['Gate fails if fallback does not engage when the API errors', 'Gate covers semantic mode, fallback mode, and reset', '`pnpm check` green'],
    files: ['`scripts/demo-gate.mjs`'],
  },
  {
    id: 'C1', track: 'track:C', priority: 'p1',
    title: 'Visual pass on the three demo screens',
    points: 'Design & UX 5 — "UI layout is modern, clean, professional, and visually cohesive"',
    why: 'Judges see three screens: workspace, evidence review, judge room. Those three carry the entire Design & UX score.',
    steps: [
      'Audit spacing, type scale, and colour consistency across the three screens.',
      'Review on the ACTUAL demo laptop and the venue projector if possible — contrast that works on a MacBook can disappear on a projector.',
      'Fix the worst three inconsistencies. Do not redesign.',
    ],
    done: ['Consistent spacing and type scale', 'Checked on the real demo screen', 'No regression in `pnpm demo`'],
    files: ['`src/styles.css`', '`index.html`'],
  },
  {
    id: 'C2', track: 'track:C', priority: 'p1',
    title: 'Make the evidence citation visually unmissable',
    points: 'Innovation & Uniqueness 5 · Design & UX 5',
    why: 'The quoted transcript span IS the differentiator. If a visitor does not notice it, we look like every other speaking coach and the unique-logic criterion is lost.',
    steps: [
      'Treat the quoted span as the primary content of a criterion card, not a footnote.',
      'Consider: quotation styling, a highlight, or a visible link from criterion to sentence.',
      'Test it: show a teammate who has not seen the app and ask what the card is telling them.',
    ],
    done: ['A first-time viewer identifies "this quote is why" without prompting', 'Works at 390px'],
    files: ['`src/styles.css`', '`src/app.mjs`'],
  },
  {
    id: 'C3', track: 'track:C', priority: 'p2',
    title: 'Booth display: hero screen and value proposition',
    points: 'Booth & Visual 10 — "promotional materials clearly convey the product\'s main idea and value"',
    why: 'Visitors decide in about three seconds whether to stop at your booth. One legible sentence does that work.',
    steps: [
      'One screen: product name, one-line value proposition, and the loop diagram.',
      'Must be legible from 2m.',
      'No distracting motion — the live demo is the thing that should hold attention.',
    ],
    done: ['Legible from 2m on the venue screen', 'Contains the one-line value proposition', 'No motion that competes with the live demo'],
    files: ['booth materials'],
  },
  {
    id: 'C4', track: 'track:C', priority: 'p2',
    title: 'Printed one-pager',
    points: 'Booth & Visual 10 · Product Impact 10',
    why: 'Judges walk the exhibition and cannot remember ten booths. A one-pager is what they carry away.',
    steps: [
      'Include: the problem with its number, the loop diagram, the QR code, the team, and one honest sentence about what works today.',
      'Reuse the figures from the proposal — they already scored well.',
      'Print at least 30 copies.',
    ],
    done: ['A visitor who reads only this can explain what we do', 'QR code scannable from the print', '30+ copies printed'],
    files: ['`docs/proposal/fig-loop.tex`', 'booth materials'],
  },
  {
    id: 'D1', track: 'track:D', priority: 'demo-critical',
    title: '7-minute pitch script with the hero moment at minute 4',
    points: 'Pitching & Q&A 10 — "delivered clearly, engagingly, and within the 7-minute limit"',
    why: 'The timer is visible and the pitch is CUT OFF at 7 minutes. Running long does not lose style points; it loses your ending.',
    steps: [
      'Use the beat sheet in section 9 of the sprint spec.',
      'Write it out in full, then cut 20%.',
      'Target 6:30 so there is 30s of slack for a slow demo.',
      'Rehearse standing up, out loud, with the actual slides.',
    ],
    done: ['Three consecutive runs land between 6:15 and 6:45', 'The hero demo starts by minute 4', 'Rehearsed standing, out loud, at least 5 times'],
    files: ['pitch script'],
  },
  {
    id: 'D2', track: 'track:D', priority: 'demo-critical',
    title: 'Demo choreography and API-failure recovery line',
    points: 'Pitching & Q&A 10 · Technical Execution 10',
    why: 'If the API dies mid-demo and the presenter freezes, we lose the room. If the presenter says one prepared sentence and keeps going, we look prepared.',
    steps: [
      'Write down the exact click sequence for the hero demo.',
      'Pre-load the workspace state before going on stage.',
      'Write the recovery line. Something like: "That is our offline mode — the rubric grounding still works without the model, which is exactly why we built the fallback."',
      'Rehearse once with the network physically off.',
    ],
    done: ['Click sequence written down and followed by two different people', 'Recovery line rehearsed', 'Full demo rehearsed with wifi disabled'],
    files: ['pitch script'],
  },
  {
    id: 'D3', track: 'track:D', priority: 'p1',
    title: 'Q&A bank with answers under 30 seconds',
    points: 'Pitching & Q&A 10 — "answers judges\' questions confidently and accurately in the 3-minute Q&A"',
    why: '3 minutes is roughly 6 questions. A rambling answer costs you two more. Short, direct answers score.',
    steps: [
      'Write every question a judge could ask. Start with the hard ones: "How is this different from ChatGPT?", "Is this just keyword matching?", "Who pays?", "What if the model is wrong?"',
      'Answer each in 30 seconds or less. Then stop talking.',
      'Add EVERY question the mentors ask on Days 1-4.',
    ],
    done: ['At least 20 questions with answers', 'Every mentor question from Days 1-4 included', 'Each answer delivered in under 30s'],
    files: ['Q&A bank doc'],
  },
  {
    id: 'D4', track: 'track:D', priority: 'p1',
    title: 'Drill Q&A using Talk-Active itself against the finals rubric',
    points: 'Pitching & Q&A 10 · Innovation & Uniqueness 5',
    why: 'We did this for the proposal and it found a real gap (Business Strategy at 0%). It works, it is on brand, and the screenshot is itself evidence for the pitch.',
    steps: [
      'Enter the Final Presentation scoring matrix as a rubric.',
      'Run the actual pitch transcript through it.',
      'Fix whatever criterion comes back weakest. Repeat until every criterion is defensible.',
      'Keep the before/after screenshots.',
    ],
    done: ['Every criterion reaches defensible', 'Before/after screenshots kept', 'At least one real change made to the pitch because of it'],
    files: ['pitch script'],
  },
  {
    id: 'D5', track: 'track:D', priority: 'p1',
    title: 'Pitch deck matching the guidebook content list',
    points: 'Pitching & Q&A 10 · Solution Alignment 5',
    why: 'The guidebook names exactly what the deck must cover: value proposition, tech stack, product architecture, core features, and live functionality. Missing one is a free deduction.',
    steps: [
      'Build slides for each required item.',
      'Reuse the architecture and loop diagrams from the proposal.',
      'Keep text minimal — you are talking, the slide is not.',
      'One slide is just the live demo placeholder.',
    ],
    done: ['Covers all five required items', 'Reuses proposal diagrams', 'No slide has more than 20 words'],
    files: ['deck'],
  },
  {
    id: 'E2', track: 'track:E', priority: 'p1',
    title: 'Nightly full gate run and known-good tag',
    points: 'Technical Execution 10',
    why: 'If someone breaks main at 2am on Day 4, we need a commit we know demos cleanly. Without a tag we would be debugging under pressure on the morning of the 14th.',
    steps: [
      'Each night: run `pnpm check`, and if green, `git tag demo-YYYYMMDD && git push --tags`.',
      'Note the tag in the WhatsApp group.',
    ],
    done: ['A tagged, gate-green commit exists for each of Days 1-4'],
    files: ['git tags'],
  },
  {
    id: 'E3', track: 'track:E', priority: 'demo-critical',
    title: 'Prepare the offline demo laptop',
    points: 'Technical Execution 10 · Interactive Demo 15',
    why: 'Venue wifi at a student event is not something to bet 25 points on. Running from localhost removes the network from the critical path entirely.',
    steps: [
      'Clone the known-good tag onto the demo laptop.',
      'Run `pnpm dev` locally and confirm the full demo works with wifi DISABLED (it will use deterministic mode — that is fine and honest).',
      'Bookmark the local URL. Seed the workspace with the demo data.',
      'Pack: charger, HDMI adapter, USB-C adapter, phone hotspot as backup.',
    ],
    done: ['Full demo runs with wifi physically disabled', 'Adapters tested against the venue projector if possible', 'Laptop charged and packed the night before'],
    files: ['demo laptop'],
  },
  {
    id: 'E4', track: 'track:E', priority: 'blocker',
    title: 'Final submission package by 13 Aug 23.55',
    points: 'ALL — late submission is treated as withdrawal',
    why: 'Guidebook: teams that fail to submit by the deadline "will be deemed to have withdrawn from the competition." This is the one task where being late scores zero on everything.',
    steps: [
      'Confirm exactly what must be submitted at the Final Round Technical Briefing.',
      'Assemble: final product link, pitch deck, any required documentation.',
      'Submit by 21.00, not 23.50. Leave three hours of margin.',
      'Screenshot the confirmation.',
    ],
    done: ['Submitted before 13 Aug 23.55', 'Confirmation screenshotted and posted in the team group', 'Submitted by 21.00 to leave margin'],
    files: ['submission portal'],
  },
];

function body(task) {
  const lines = [
    `## Why this matters`,
    ``,
    `**Defends:** ${task.points}`,
    ``,
    task.why,
    ``,
    `## What to do`,
    ``,
    ...task.steps.map((step, index) => `${index + 1}. ${step}`),
    ``,
    `## Done when`,
    ``,
    ...task.done.map((item) => `- [ ] ${item}`),
    `- [ ] \`pnpm check\` is green (this is the definition of done and the permission to merge)`,
    ``,
    `## Where`,
    ``,
    task.files.join(' · '),
    ``,
    `---`,
    ``,
    `Task \`${task.id}\` · [full sprint spec](${SPEC_URL})`,
    ``,
    `> Never weaken a test to go green. Fix the work, or change the invariant in \`AGENTS.md\` deliberately, with the team's agreement.`,
  ];
  return lines.join('\n');
}

const dryRun = process.argv.includes('--dry-run');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

if (dryRun) {
  const sample = TASKS[6]; // B1 — the one with real urgency
  process.stdout.write(`--- sample: [${sample.id}] ${sample.title} ---\n\n${body(sample)}\n\n`);
  process.stdout.write(`${TASKS.length} issues would be created or updated.\n`);
  process.exit(0);
}

const existing = JSON.parse(gh(['issue', 'list', '--limit', '200', '--state', 'all', '--json', 'number,title']));
const byTitle = new Map(existing.map((issue) => [issue.title, issue.number]));

let created = 0;
let updated = 0;
for (const task of TASKS) {
  const title = `[${task.id}] ${task.title}`;
  const text = body(task);
  const number = byTitle.get(title)
    // The first pass used slightly different titles; match on the [ID] prefix too.
    ?? existing.find((issue) => issue.title.startsWith(`[${task.id}]`))?.number;

  if (number) {
    gh(['issue', 'edit', String(number), '--title', title, '--body', text,
      '--add-label', task.track, '--add-label', task.priority]);
    process.stdout.write(`  updated  #${number}  ${title}\n`);
    updated += 1;
  } else {
    gh(['issue', 'create', '--title', title, '--body', text,
      '--label', task.track, '--label', task.priority]);
    process.stdout.write(`  created  ${title}\n`);
    created += 1;
  }
}

process.stdout.write(`\ndone: ${created} created, ${updated} updated.\n`);
