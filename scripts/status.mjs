#!/usr/bin/env node
// ============================================================================
//  One command that answers "where are we right now".
//
//    pnpm status
//
//  Shows who is on what, what is unclaimed, whether CI is green, and how long
//  is left before the submission deadline. Read it at the 11.00 standup instead
//  of going around the table guessing.
//
//  Needs an authenticated GitHub CLI (`gh auth login`).
// ============================================================================
import { execFileSync } from 'node:child_process';

const DEADLINE = new Date('2026-08-13T18:00:00+07:00'); // WIB, technical meeting slide 11
const EXHIBITION = new Date('2026-08-14T09:00:00+07:00');

const c = {
  reset: '[0m', bold: '[1m', dim: '[2m',
  red: '[31m', green: '[32m', yellow: '[33m',
  blue: '[34m', magenta: '[35m', cyan: '[36m',
};

function gh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', CLICOLOR: '0', GH_PAGER: 'cat' },
    }).replace(/\[[0-9;]*[A-Za-z]/gu, '');
  } catch {
    return null;
  }
}

function hoursLeft(target) {
  return (target.getTime() - Date.now()) / 36e5;
}

function countdown() {
  const toSubmit = hoursLeft(DEADLINE);
  const toShow = hoursLeft(EXHIBITION);
  const fmt = (hours) => {
    if (hours < 0) return `${c.red}PASSED${c.reset}`;
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    const colour = hours < 24 ? c.red : hours < 48 ? c.yellow : c.green;
    return `${colour}${d}d ${h}h${c.reset}`;
  };
  console.log(`${c.bold}COUNTDOWN${c.reset}`);
  console.log(`  submission (13 Aug 18.00)  ${fmt(toSubmit)}`);
  console.log(`  exhibition (14 Aug 09.00)  ${fmt(toShow)}`);
  console.log();
}

function issues() {
  const raw = gh(['issue', 'list', '--limit', '100', '--state', 'open',
    '--json', 'number,title,labels,assignees']);
  if (!raw) {
    console.log(`${c.yellow}Could not read issues. Run: gh auth login${c.reset}\n`);
    return;
  }
  const open = JSON.parse(raw);
  const labels = (issue) => issue.labels.map((label) => label.name);
  const owner = (issue) => issue.assignees.map((a) => a.login).join(', ');

  const inProgress = open.filter((issue) => issue.assignees.length > 0);
  const unclaimed = open.filter((issue) => issue.assignees.length === 0);
  const critical = unclaimed.filter((issue) => labels(issue).includes('demo-critical'));

  console.log(`${c.bold}IN PROGRESS${c.reset}  ${c.dim}(assigned and open)${c.reset}`);
  if (inProgress.length === 0) {
    console.log(`  ${c.yellow}nobody has claimed anything — that is the first standup action${c.reset}`);
  }
  for (const issue of inProgress) {
    console.log(`  ${c.cyan}#${issue.number}${c.reset} ${issue.title}`);
    console.log(`      ${c.dim}${owner(issue)}${c.reset}`);
  }
  console.log();

  console.log(`${c.bold}UNCLAIMED, DEMO-CRITICAL${c.reset}  ${c.dim}(take these first)${c.reset}`);
  if (critical.length === 0) console.log(`  ${c.green}none — every demo-critical task is claimed${c.reset}`);
  for (const issue of critical) {
    console.log(`  ${c.red}#${issue.number}${c.reset} ${issue.title}`);
  }
  console.log();

  const byTrack = new Map();
  for (const issue of open) {
    const track = labels(issue).find((name) => name.startsWith('track:')) ?? 'track:?';
    byTrack.set(track, (byTrack.get(track) ?? 0) + 1);
  }
  const names = {
    'track:A': 'AI core', 'track:B': 'Demo resilience', 'track:C': 'Interface & booth',
    'track:D': 'Pitch & Q&A', 'track:E': 'Integration & ops',
  };
  console.log(`${c.bold}OPEN BY TRACK${c.reset}`);
  for (const [track, count] of [...byTrack].sort()) {
    console.log(`  ${track.padEnd(9)} ${String(count).padStart(2)}  ${c.dim}${names[track] ?? ''}${c.reset}`);
  }
  console.log(`  ${c.dim}${open.length} open in total${c.reset}`);
  console.log();
}

function ci() {
  const raw = gh(['run', 'list', '--limit', '5', '--json',
    'status,conclusion,headBranch,displayTitle,createdAt']);
  console.log(`${c.bold}CI${c.reset}`);
  if (!raw) { console.log(`  ${c.dim}unavailable${c.reset}\n`); return; }
  const runs = JSON.parse(raw);
  if (runs.length === 0) {
    console.log(`  ${c.dim}no runs yet — push to trigger the first one${c.reset}\n`);
    return;
  }
  for (const run of runs) {
    const state = run.status !== 'completed'
      ? `${c.yellow}${run.status}${c.reset}`
      : run.conclusion === 'success' ? `${c.green}pass${c.reset}` : `${c.red}${run.conclusion}${c.reset}`;
    console.log(`  ${state.padEnd(18)} ${c.dim}${run.headBranch}${c.reset}  ${run.displayTitle.slice(0, 46)}`);
  }
  console.log();
}

function localState() {
  const branch = (gh(['api', 'user', '--jq', '.login']) && null) ?? null;
  let current = '';
  try {
    current = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  } catch { /* not a repo */ }
  let dirty = '';
  try {
    dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  } catch { /* ignore */ }

  console.log(`${c.bold}YOUR MACHINE${c.reset}`);
  console.log(`  branch     ${current || 'unknown'}`);
  console.log(`  uncommitted ${dirty ? `${c.yellow}${dirty.split('\n').length} file(s)${c.reset}` : `${c.green}clean${c.reset}`}`);
  console.log(`  ${c.dim}run \`pnpm check\` before you push — the hook will anyway${c.reset}`);
  console.log();
  void branch;
}

console.log();
console.log(`${c.bold}${c.magenta}  TALK-ACTIVE — SPRINT STATUS${c.reset}`);
console.log(`${c.dim}  ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })} WIB${c.reset}`);
console.log();
countdown();
issues();
ci();
localState();
console.log(`${c.dim}  board: https://github.com/dafandikri/talk-active/issues${c.reset}`);
console.log(`${c.dim}  claim one: pnpm take <issue-number>${c.reset}`);
console.log();
