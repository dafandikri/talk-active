import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD_PATH = 'docs/TECHNICAL-MEETING-2026.md';
const SCREENSHOT_DIR = 'docs/Technical Meeting Slides';
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const record = read(RECORD_PATH);
const flat = (text) => text.replace(/\s+/gu, ' ');

function assertContains(text, pattern, message) {
  assert.ok(pattern.test(flat(text)), message);
}

test('technical-meeting record preserves the complete 20-slide source inventory', () => {
  const expectedSources = [
    'Screenshot 2026-08-10 at 12.51.20.png',
    'Screenshot 2026-08-10 at 12.51.24.png',
    'Screenshot 2026-08-10 at 12.51.25.png',
    'Screenshot 2026-08-10 at 12.51.27.png',
    'Screenshot 2026-08-10 at 12.51.28.png',
    'Screenshot 2026-08-10 at 12.51.29.png',
    'Screenshot 2026-08-10 at 12.51.30.png',
    'Screenshot 2026-08-10 at 12.51.31.png',
    'Screenshot 2026-08-10 at 12.51.32.png',
    'Screenshot 2026-08-10 at 12.51.33.png',
    'Screenshot 2026-08-10 at 12.51.35.png',
    'Screenshot 2026-08-10 at 12.51.36.png',
    'Screenshot 2026-08-10 at 12.51.37.png',
    'Screenshot 2026-08-10 at 12.51.38.png',
    'Screenshot 2026-08-10 at 12.51.40.png',
    'Screenshot 2026-08-10 at 12.51.41.png',
    'Screenshot 2026-08-10 at 12.51.42.png',
    'Screenshot 2026-08-10 at 12.51.43.png',
    'Screenshot 2026-08-10 at 12.51.44.png',
    'Screenshot 2026-08-10 at 12.51.45.png',
  ];
  const referenced = [...record.matchAll(/^Source artifact: `(Screenshot 2026-08-10 at 12\.51\.\d{2}\.png)` \(local screenshot; Git-ignored\)$/gmu)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(
    referenced,
    expectedSources.sort(),
    'the committed record must retain every source label exactly once',
  );
  assert.equal(
    [...record.matchAll(/^### Slide \d+\b/gmu)].length,
    20,
    'the text record must retain all 20 slide sections',
  );

  // Source captures are intentionally excluded from Git. If a contributor has
  // the local folder, use it as an extra fidelity check without making clones
  // depend on large binary files.
  if (existsSync(join(ROOT, SCREENSHOT_DIR))) {
    const localSources = readdirSync(join(ROOT, SCREENSHOT_DIR))
      .filter((name) => name.endsWith('.png'))
      .sort();
    assert.deepEqual(localSources, expectedSources.sort(), 'local screenshot inventory drifted from the transcription');
  }
});

test('technical-meeting binding requirement register cannot silently lose a rule', () => {
  const expectedIds = [
    'TM-SUB-001',
    'TM-SUB-002',
    'TM-SUB-003',
    'TM-SUB-004',
    'TM-SUB-005',
    'TM-SUB-006',
    'TM-BOOTH-001',
    'TM-BOOTH-002',
    'TM-PITCH-001',
    'TM-PITCH-002',
    'TM-PITCH-003',
    'TM-PITCH-004',
    'TM-PITCH-005',
    'TM-INTEGRITY-001',
    'TM-SCORE-001',
    'TM-SCORE-002',
    'TM-DAY5-001',
    'TM-DAY5-002',
    'TM-TEAM-001',
  ];
  const actualIds = [...record.matchAll(/^\| (TM-[A-Z0-9-]+) \|/gmu)]
    .map((match) => match[1]);

  assert.deepEqual(actualIds, expectedIds, 'binding and operational meeting requirements drifted');
});

test('submission rules preserve the official deadline and mandatory deck contents', () => {
  const facts = [
    [/Google Classroom/iu, 'submission platform'],
    [/Thursday, 13 August 2026 at 18\.00 WIB/iu, 'official submission deadline'],
    [/Presentation Deck \(PDF or PPTX\)/iu, 'allowed deck formats'],
    [/Team Name, Member Names, Product Name,\s+and Logo/iu, 'cover fields'],
    [/ristek\.link\/RISTEKHackathon2026Logo/iu, 'official logo asset'],
    [/direct links? to the Final Product/iu, 'final product link'],
    [/public\/accessible GitHub repository link/iu, 'public repository link'],
  ];

  for (const [pattern, label] of facts) {
    assertContains(record, pattern, `technical-meeting record lost the ${label} requirement`);
  }
});

test('event operations preserve attendance, timing, dress, and slide-control rules', () => {
  const facts = [
    [/at least 50% of the team must attend/iu, 'Innovation Forum team split'],
    [/06\.30[–-]07\.30 \| Participant Arrival/iu, 'Day 5 arrival time'],
    [/09\.00[–-]11\.00 \| Innovation Forum/iu, 'Innovation Forum time'],
    [/09\.00[–-]12\.00 \| Exhibition Visit/iu, 'exhibition time'],
    [/2 minutes preparation; 7 minutes presentation; 3 minutes Q&A/iu, 'pitch allocation'],
    [/MC will enforce a hard stop/iu, 'hard-stop rule'],
    [/Screensharing of the deck will come from the operator/iu, 'operator slide control'],
    [/shorts, sandals, sleeveless clothing/iu, 'prohibited dress'],
  ];

  for (const [pattern, label] of facts) {
    assertContains(record, pattern, `technical-meeting record lost the ${label}`);
  }
});

test('official scoring weights retain their labels and each matrix sums to 100%', () => {
  const finalPresentation = [
    ['Problem Identification', 15],
    ['Solution Alignment', 15],
    ['Innovation & Uniqueness', 10],
    ['Technical Execution', 30],
    ['Design & User Experience', 10],
    ['Pitching and Q&A Response', 20],
  ];
  const exhibition = [
    ['Booth & Visual Display', 20],
    ['Interactive Demo & Prototype', 30],
    ['Communication & Engagement', 30],
    ['Product Impact & Innovation', 20],
  ];

  for (const [label, weight] of [...finalPresentation, ...exhibition]) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    assertContains(record, new RegExp(`${escaped} \\| ${weight}%`, 'iu'), `${label} must remain ${weight}%`);
  }
  assert.equal(finalPresentation.reduce((sum, [, weight]) => sum + weight, 0), 100);
  assert.equal(exhibition.reduce((sum, [, weight]) => sum + weight, 0), 100);
});

test('penalties and integrity boundaries remain explicit', () => {
  const facts = [
    [/Incorrect file naming format \| −1 point/iu, 'incorrect file-name penalty'],
    [/Late submission \(<2 hours\) \| −2 points per 5 minutes/iu, 'short late-submission penalty'],
    [/Late submission \(>=2 hours\) \| Final Product receives 0 score/iu, 'two-hour late penalty'],
    [/Changing presentation content after deadline \| −5 points/iu, 'post-deadline change penalty'],
    [/Plagiarism or unoriginal work \| Disqualification/iu, 'plagiarism penalty'],
    [/Fabrication of data or sources \| Disqualification/iu, 'fabrication penalty'],
    [/Third-party involvement in preparing solutions \| Disqualification/iu, 'third-party penalty'],
    [/Failure to attend assigned presentation slot \| Disqualification/iu, 'presentation absence penalty'],
    [/screenshots do not state the required naming pattern/iu, 'file-naming ambiguity boundary'],
    [/do not define the event's AI-assistance policy/iu, 'AI policy ambiguity boundary'],
  ];

  for (const [pattern, label] of facts) {
    assertContains(record, pattern, `technical-meeting record lost the ${label}`);
  }
});

test('active project surfaces use the 18.00 deadline and contain no stale 23.55 claim', () => {
  const synchronizedFiles = [
    'AGENTS.md',
    'docs/ONBOARDING.md',
    'docs/specs/2026-08-10-innovation-week.md',
    'scripts/status.mjs',
    'scripts/seed-issues.mjs',
  ];

  for (const relative of synchronizedFiles) {
    const source = read(relative);
    assert.doesNotMatch(source, /23[.:]55/u, `${relative} still contains the superseded 23.55 deadline`);
  }

  assertContains(read('AGENTS.md'), /official submission deadline is 13 August at 18\.00 WIB/iu, 'AGENTS.md deadline drifted');
  assertContains(read('docs/specs/2026-08-10-innovation-week.md'), /13 Aug 18\.00 WIB/iu, 'active sprint deadline drifted');
  assertContains(read('docs/specs/2026-08-10-innovation-week.md'), /06\.30[–-]07\.30.*Participant arrival/iu, 'active sprint lost Day 5 arrival');
  assertContains(read('docs/specs/2026-08-10-innovation-week.md'), /At least 3 of 5 members.*forum.*remaining 2.*booth/iu, 'active sprint lost simultaneous staffing requirement');
  assertContains(read('scripts/status.mjs'), /2026-08-13T18:00:00\+07:00/iu, 'countdown uses the wrong instant');
  assertContains(read('scripts/seed-issues.mjs'), /Submitted by 17\.00 to leave margin/iu, 'submission task lost its safety margin');
});

test('pnpm project exposes and checks the technical-meeting record', () => {
  const projectSource = read('scripts/project.mjs');
  assertContains(projectSource, /docs\/TECHNICAL-MEETING-2026\.md/iu, 'project artifact gate does not require the meeting record');

  const output = execFileSync(process.execPath, ['scripts/project.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assertContains(output, /technical-meeting,"docs\/TECHNICAL-MEETING-2026\.md"/iu, 'project home does not surface the meeting record to agents');
});
