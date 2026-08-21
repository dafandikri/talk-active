#!/usr/bin/env node
// ============================================================================
//  Does the AI Gateway credential still have life left in it?
//
//    pnpm check:gateway
//
//  On 19 August 2026 the production key expired. Every semantic call started
//  returning 401, the analyzer degraded to deterministic cue matching exactly
//  as designed, and nobody noticed for a day: the fallback is silent by
//  intent, and the expiry date lived in a Markdown table that nothing ran.
//
//  This turns that date into something enforced. It answers one question the
//  runtime cannot answer for itself, because a key's expiry is only visible
//  from the outside — and by the time the runtime can see the failure, a
//  student has already been served the fallback.
//
//  Needs an authenticated Vercel CLI. Without one it reports `skipped` and
//  exits 0, so a contributor with no deployment access is never blocked by a
//  credential they cannot see.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SCRIPT_PATH));

/** Days of runway a key must still have before the gate calls it healthy. */
export const MIN_HEADROOM_DAYS = 14;

const DAY_MS = 86_400_000;

function quoted(value) {
  return JSON.stringify(String(value));
}

function displayPath(value) {
  const home = homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

/**
 * Reads the key rows out of `vercel ai-gateway api-keys list`.
 *
 * The CLI has no JSON mode, so this parses the human table. It deliberately
 * anchors on the id column's shape rather than on column offsets, which move
 * whenever a longer key name is added.
 */
export function parseKeyList(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const match = /^\s{2,}([A-Za-z0-9_-]{20,})\s{2,}(\S+)/u.exec(line);
    if (match) rows.push({ id: match[1], name: match[2] });
  }
  return rows;
}

/**
 * Reads the `expires` field out of `vercel ai-gateway api-keys inspect <id>`.
 *
 * Returns null for a key that never expires. Throws when the field is absent
 * or unreadable: an expiry this script cannot parse must never be mistaken for
 * one that is comfortably far away.
 */
export function parseExpires(text) {
  const match = /^\s*expires\s{2,}(.+?)\s*$/mu.exec(String(text));
  if (!match) throw new Error('The key detail carried no expiry field.');

  const raw = match[1].trim();
  if (/^(never|none|-|—)$/iu.test(raw)) return null;

  // V8 parses "8/19/2026 2:19:44 AM" reliably; the comma the CLI prints is the
  // one character that makes it ambiguous.
  const parsed = new Date(raw.replace(',', ''));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`The key expiry ${quoted(raw)} could not be read as a date.`);
  }
  return parsed;
}

export function classifyKey(key, now, minDays = MIN_HEADROOM_DAYS) {
  if (key.expires === null) {
    return { id: key.id, name: key.name, status: 'healthy', daysLeft: null };
  }
  const daysLeft = Math.round(((key.expires.getTime() - now.getTime()) / DAY_MS) * 10) / 10;
  const status = daysLeft < 0 ? 'expired' : daysLeft < minDays ? 'expiring' : 'healthy';
  return { id: key.id, name: key.name, status, daysLeft };
}

/**
 * One healthy key is enough. This cannot tell which key production actually
 * holds — `AI_GATEWAY_API_KEY` is Sensitive and Vercel never hands the value
 * back — so a retired expired key sitting alongside a good one is not a
 * failure, and a healthy key nobody wired up is not a pass. The gate checks
 * that a usable credential exists; the operator still owns which one is set.
 */
export function summarise(classified) {
  const count = (status) => classified.filter((key) => key.status === status).length;
  const healthy = count('healthy');
  return {
    ok: healthy > 0,
    total: classified.length,
    healthy,
    expiring: count('expiring'),
    expired: count('expired'),
  };
}

function vercel(args) {
  try {
    return {
      ok: true,
      text: execFileSync('vercel', args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', CLICOLOR: '0' },
      }).replace(/\[[0-9;]*[A-Za-z]/gu, ''),
    };
  } catch (error) {
    const detail = `${error?.stderr ?? ''}${error?.stdout ?? ''}`;
    if (error?.code === 'ENOENT') {
      return { ok: false, reason: 'The Vercel CLI is not installed on this machine.' };
    }
    if (/credentials|not authenticated|log ?in/iu.test(detail)) {
      return { ok: false, reason: 'The Vercel CLI is not signed in.' };
    }
    if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network/iu.test(detail)) {
      return { ok: false, reason: 'The Vercel API could not be reached.' };
    }
    return { ok: false, reason: 'The Vercel CLI could not list AI Gateway keys.' };
  }
}

function renderKeys(classified) {
  const rows = classified
    .map((key) => `  ${quoted(key.name)},${key.status},${key.daysLeft ?? 'never'}`)
    .join('\n');
  return `keys[${classified.length}]{name,status,daysLeft}:\n${rows}`;
}

function skipped(reason) {
  process.stdout.write([
    'gateway-key:',
    '  status: skipped',
    `  reason: ${quoted(reason)}`,
    `help: ${quoted('Run `vercel login` to enable this check; it is advisory and never blocks a contributor without deployment access.')}`,
  ].join('\n') + '\n');
}

function collect() {
  const listed = vercel(['ai-gateway', 'api-keys', 'list']);
  if (!listed.ok) return listed;

  const classified = [];
  const now = new Date();
  for (const key of parseKeyList(listed.text)) {
    const detail = vercel(['ai-gateway', 'api-keys', 'inspect', key.id]);
    if (!detail.ok) return detail;
    classified.push(classifyKey({ ...key, expires: parseExpires(detail.text) }, now));
  }
  return { ok: true, classified };
}

function check() {
  let collected;
  try {
    collected = collect();
  } catch (error) {
    // A parse failure is format drift, not a missing credential. Failing here
    // is the whole point: a check that cannot read its input must not report
    // success, or it becomes the silent no-op it was written to replace.
    process.stdout.write([
      'gateway-key:',
      '  status: failed',
      `  reason: ${quoted(error.message)}`,
      `help: ${quoted('The `vercel ai-gateway api-keys` output format changed. Update parseExpires in scripts/gateway-key.mjs.')}`,
    ].join('\n') + '\n');
    process.exitCode = 1;
    return;
  }

  if (!collected.ok) {
    skipped(collected.reason);
    return;
  }

  const summary = summarise(collected.classified);
  const lines = [
    renderKeys(collected.classified),
    'gateway-key:',
    `  status: ${summary.ok ? 'passed' : 'failed'}`,
    `  headroomDays: ${MIN_HEADROOM_DAYS}`,
    `  summary: ${quoted(`${summary.healthy} healthy, ${summary.expiring} expiring, ${summary.expired} expired`)}`,
  ];
  if (!summary.ok) {
    lines.push(`help: ${quoted('Create a replacement key, then set it for Production and Preview: vercel ai-gateway api-keys create --name <name> --budget 5 --refresh-period none --expiration none')}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
  if (!summary.ok) process.exitCode = 1;
}

function home() {
  const collected = (() => {
    try {
      return collect();
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  })();
  const head = [
    `bin: ${quoted(displayPath(SCRIPT_PATH))}`,
    `description: ${quoted('Check that an AI Gateway credential with usable runway exists')}`,
  ];
  if (!collected.ok) {
    process.stdout.write(head.join('\n') + '\n');
    skipped(collected.reason);
    return;
  }
  const summary = summarise(collected.classified);
  process.stdout.write([
    ...head,
    renderKeys(collected.classified),
    `summary: ${quoted(`${summary.healthy} of ${summary.total} keys have at least ${MIN_HEADROOM_DAYS} days of runway`)}`,
    `help[2]: ${quoted('pnpm check:gateway')},${quoted('vercel ai-gateway api-keys list')}`,
  ].join('\n') + '\n');
}

function help() {
  process.stdout.write([
    'command: gateway-key',
    `description: ${quoted('Report AI Gateway key expiry so a dead credential is caught before a student is')}`,
    `usage: ${quoted('node scripts/gateway-key.mjs [check|--help]')}`,
    'commands[1]{name,purpose}:',
    `  check,${quoted('Fail when no gateway key has usable runway left')}`,
    `settings[1]{name,value}:`,
    `  headroomDays,${MIN_HEADROOM_DAYS}`,
    `examples[2]: ${quoted('pnpm check:gateway')},${quoted('node scripts/gateway-key.mjs')}`,
  ].join('\n') + '\n');
}

function fail(command) {
  process.stdout.write([
    `error: ${quoted(`unknown command: ${command}`)}`,
    `help: ${quoted('Run `node scripts/gateway-key.mjs --help` for available commands')}`,
  ].join('\n') + '\n');
  process.exitCode = 2;
}

// Importing this module for its pure helpers must not run the CLI.
if (process.argv[1] === SCRIPT_PATH) {
  const command = process.argv[2];
  if (command === undefined) home();
  else if (command === 'check') check();
  else if (command === '--help' || command === '-h' || command === 'help') help();
  else fail(command);
}
