#!/usr/bin/env node
// ============================================================================
//  Type errors may go down. They may not go up.
//
//  The existing .mjs was written without types, so turning on checkJs +
//  strict surfaces a backlog rather than a clean sheet. Blocking every merge
//  on zero would stop all work; ignoring the number entirely would let it
//  grow until the TypeScript port inherits a mess.
//
//  So: record the count, and fail when it rises. New code lands typed because
//  untyped new code pushes the number up. Lowering it is always allowed, and
//  lowering it updates the baseline.
//
//  Every JSDoc annotation written to satisfy this transfers to the Next.js
//  port unchanged — the work is not throwaway.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASELINE = fileURLToPath(new URL('../.typecheck-baseline', import.meta.url));

function currentErrors() {
  try {
    execFileSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], { encoding: 'utf8', stdio: 'pipe' });
    return { count: 0, lines: [] };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    const lines = output.split(/\r?\n/u).filter((line) => /error TS\d+/u.test(line));
    return { count: lines.length, lines };
  }
}

function baseline() {
  try {
    return Number.parseInt(readFileSync(BASELINE, 'utf8').trim(), 10);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const { count, lines } = currentErrors();
const limit = baseline();

if (count > limit) {
  const byFile = new Map();
  for (const line of lines) {
    const file = line.split('(')[0];
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  process.stdout.write([
    'typecheck:',
    '  status: failed',
    `  errors: ${count}`,
    `  allowed: ${limit}`,
    '  help: "new code must carry types; run npx tsc --noEmit to see them"',
    'by-file{path,count}:',
    ...[...byFile.entries()].sort((a, b) => b[1] - a[1]).map(([file, n]) => `  ${file},${n}`),
  ].join('\n') + '\n');
  process.exitCode = 1;
} else {
  if (count < limit) writeFileSync(BASELINE, `${count}\n`);
  process.stdout.write([
    'typecheck:',
    '  status: passed',
    `  errors: ${count}`,
    count < limit ? `  baseline: lowered from ${Number.isFinite(limit) ? limit : 'unset'} to ${count}` : `  baseline: ${limit}`,
  ].join('\n') + '\n');
}
