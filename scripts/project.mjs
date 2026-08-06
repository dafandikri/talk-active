#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SCRIPT_PATH));
const REQUIRED = [
  'README.md',
  'AGENTS.md',
  'index.html',
  'src/app.mjs',
  'src/analyzer.mjs',
  'src/styles.css',
  'scripts/browser-check.mjs',
  'middleware.mjs',
  'vercel.json',
  'docs/FEASIBILITY.md',
  'docs/specs/2026-08-06-lancar-mvp.md',
  '.agent-harness/install.json',
  'test/analyzer.test.mjs',
];

function quoted(value) {
  return JSON.stringify(String(value));
}

function displayPath(value) {
  const home = homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function facts() {
  return REQUIRED.map((path) => ({
    id: path,
    status: existsSync(join(ROOT, path)) ? 'ready' : 'missing',
  }));
}

function renderFacts(items) {
  const rows = items.map((item) => `  ${quoted(item.id)},${item.status}`).join('\n');
  return `checks[${items.length}]{id,status}:\n${rows}`;
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

function home() {
  const items = facts();
  const ready = items.filter((item) => item.status === 'ready').length;
  process.stdout.write([
    `bin: ${quoted(displayPath(SCRIPT_PATH))}`,
    `description: ${quoted('Inspect the Lancar product workspace and its agent-ready state')}`,
    'project:',
    '  name: Lancar',
    `  version: ${quoted(packageVersion())}`,
    '  milestone: persistent-product-prototype',
    `  readiness: ${ready}/${items.length}`,
    renderFacts(items),
    `help[2]: ${quoted('pnpm dev')},${quoted('pnpm check')}`,
  ].join('\n') + '\n');
}

function check() {
  const items = facts();
  const missing = items.filter((item) => item.status === 'missing');
  process.stdout.write([
    renderFacts(items),
    `summary: ${quoted(`${items.length - missing.length}/${items.length} required artifacts ready`)}`,
  ].join('\n') + '\n');
  if (missing.length > 0) process.exitCode = 1;
}

function help() {
  process.stdout.write([
    'command: project',
    `description: ${quoted('Show compact, agent-readable state for this repository')}`,
    `usage: ${quoted('node scripts/project.mjs [check|--help]')}`,
    'commands[1]{name,purpose}:',
    `  check,${quoted('Verify that required product and harness artifacts exist')}`,
    `examples[3]: ${quoted('pnpm project')},${quoted('pnpm project check')},${quoted('pnpm check')}`,
  ].join('\n') + '\n');
}

function fail(command) {
  process.stdout.write([
    `error: ${quoted(`unknown command: ${command}`)}`,
    `help: ${quoted('Run `pnpm project --help` for available commands')}`,
  ].join('\n') + '\n');
  process.exitCode = 2;
}

const command = process.argv[2];
if (command === undefined) home();
else if (command === 'check') check();
else if (command === '--help' || command === '-h' || command === 'help') help();
else fail(command);
