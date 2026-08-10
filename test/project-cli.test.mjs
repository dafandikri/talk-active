import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function run(script, args = []) {
  return spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('project CLI home view returns compact live content instead of a manual', () => {
  const result = run('scripts/project.mjs');
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^bin: /u);
  assert.match(result.stdout, /milestone: persistent-product-prototype/u);
  assert.match(result.stdout, /requirements\[4\]\{id,path\}:/u);
  assert.match(result.stdout, /active-plan,"docs\/specs\/2026-08-10-innovation-week\.md"/u);
  assert.match(result.stdout, /technical-meeting,"docs\/TECHNICAL-MEETING-2026\.md"/u);
  assert.match(result.stdout, /finals-rubric,"docs\/rubrics\/2026-finals\.json"/u);
  assert.match(result.stdout, /finals-readiness,"docs\/finals-readiness\.json"/u);
  assert.match(result.stdout, /checks\[18\]\{id,status\}:/u);
  assert.match(result.stdout, /help\[3\]:/u);
});

test('project CLI check is definitive and self-contained', () => {
  const result = run('scripts/project.mjs', ['check']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /summary: "18\/18 required artifacts ready"/u);
  assert.doesNotMatch(result.stdout, /help/u);
});

test('agent-facing CLI errors are structured on stdout with a usage exit code', () => {
  const result = run('scripts/project.mjs', ['unknown']);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /error: "unknown command: unknown"/u);
  assert.match(result.stdout, /help:/u);
});

test('local server rejects invalid ports with structured output', () => {
  const result = run('scripts/serve.mjs', ['--port', 'not-a-port']);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /error: "invalid --port value"/u);
  assert.match(result.stdout, /help:/u);
});
