#!/usr/bin/env node
// ============================================================================
//  Claim an issue and start on it, in one command.
//
//    pnpm take 6
//
//  Assigns the issue to you, comments so the team sees it in real time, and
//  creates a branch named after it. The branch name is what links the eventual
//  pull request back to the issue, which is what makes the board update itself.
//
//  WIP limit is 1. If you already have something assigned, this says so.
// ============================================================================
import { execFileSync } from 'node:child_process';

const number = process.argv[2];
if (!number || !/^\d+$/u.test(number)) {
  process.stderr.write('usage: pnpm take <issue-number>\n   eg: pnpm take 6\n');
  process.exit(2);
}

function gh(args, { quiet = false } = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, NO_COLOR: '1', CLICOLOR: '0', GH_PAGER: 'cat' },
  }).replace(/\[[0-9;]*[A-Za-z]/gu, '');
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const me = gh(['api', 'user', '--jq', '.login'], { quiet: true }).trim();

// WIP limit 1: finishing beats starting, especially with four days left.
const mine = JSON.parse(
  gh(['issue', 'list', '--state', 'open', '--assignee', me, '--json', 'number,title'], { quiet: true }),
);
const others = mine.filter((issue) => String(issue.number) !== number);
if (others.length > 0) {
  process.stderr.write(`\nYou already have work in progress:\n`);
  for (const issue of others) process.stderr.write(`  #${issue.number} ${issue.title}\n`);
  process.stderr.write('\nWIP limit is 1. Finish or hand that off first.\n');
  process.stderr.write('Override deliberately with: pnpm take ' + number + ' --anyway\n\n');
  if (!process.argv.includes('--anyway')) process.exit(1);
}

const issue = JSON.parse(
  gh(['issue', 'view', number, '--json', 'number,title,labels'], { quiet: true }),
);

const slug = issue.title
  .toLowerCase()
  .replace(/^\[[a-z]\d+\]\s*/u, '')
  .replace(/[^a-z0-9]+/gu, '-')
  .replace(/^-|-$/gu, '')
  .slice(0, 40);
const id = (issue.title.match(/^\[([A-Z]\d+)\]/u)?.[1] ?? `issue`).toLowerCase();
const branch = `${id}-${slug}`;

gh(['issue', 'edit', number, '--add-assignee', me], { quiet: true });
gh(['issue', 'comment', number, '--body',
  `Started by @${me} on \`${branch}\`.`], { quiet: true });

// Branch from the current sprint branch so work stays close to the plan.
const base = git(['rev-parse', '--abbrev-ref', 'HEAD']);
try {
  git(['checkout', '-b', branch]);
} catch {
  git(['checkout', branch]);
}

process.stdout.write(`
  claimed  #${issue.number} ${issue.title}
  branch   ${branch}  (from ${base})
  you      ${me}

  When you are done:
    git push -u origin ${branch}
    gh pr create --fill --body "Closes #${issue.number}"

  The pre-push hook runs \`pnpm check\` first. Green gate is the
  permission to merge, and "Closes #${issue.number}" closes the issue
  automatically when the PR merges.

`);
