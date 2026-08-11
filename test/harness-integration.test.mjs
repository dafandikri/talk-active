import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('model adapters point to the canonical project instructions', () => {
  for (const adapter of [
    'CLAUDE.md',
    'GEMINI.md',
    'QWEN.md',
    '.github/copilot-instructions.md',
  ]) {
    assert.match(read(adapter), /AGENTS\.md/u, `${adapter} must point to AGENTS.md`);
  }

  const receipt = JSON.parse(read('.agent-harness/install.json'));
  for (const adapter of ['claude', 'codex', 'gemini', 'qwen', 'copilot']) {
    assert.ok(receipt.adapters.includes(adapter), `${adapter} adapter must be recorded by agent-harness`);
  }

  assert.match(read('README.md'), /docs\/AGENT-WORKFLOW\.md/u);
});

test('the repository ships its captain workflow as an executable skill contract', () => {
  const path = '.agents/skills/captains-workflow/SKILL.md';
  assert.equal(existsSync(join(ROOT, path)), true, `${path} must exist`);
  const skill = read(path);
  for (const phase of ['Plan', 'Isolate', 'Build', 'Validate', 'Deliver']) {
    assert.match(skill, new RegExp(`\\*\\*${phase}`, 'u'), `captain workflow must define ${phase}`);
  }
  assert.match(skill, /Never auto-commit\/push\/PR without an explicit request/iu);
});

test('pnpm check reaches every product-quality gate', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts.test, 'node --test');
  for (const command of [
    'node --test',
    'node scripts/browser-check.mjs',
    'node scripts/demo-gate.mjs',
    'node scripts/project.mjs check',
    'node scripts/finals-rubric.mjs check',
  ]) {
    assert.match(scripts.check, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});

test('local push and remote CI both enforce the same complete gate', () => {
  const hookPath = join(ROOT, '.githooks/pre-push');
  assert.equal(existsSync(hookPath), true, 'pre-push hook must exist');
  // Git's index is the portable source of truth. Windows filesystems do not
  // expose POSIX executable bits, but every checkout still receives this mode.
  const indexEntry = execFileSync('git', ['ls-files', '--stage', '.githooks/pre-push'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(indexEntry, /^100755\s/u, 'git must distribute the pre-push hook as executable');
  assert.match(read('.githooks/pre-push'), /pnpm check/u);

  const workflow = read('.github/workflows/check.yml');
  assert.match(workflow, /push:/u);
  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /pnpm check \| tee gate\.log/u);
  assert.match(workflow, /playwright@latest install --with-deps chromium/u);
  assert.match(workflow, /status: skipped/u);
});

test('the pull request contract protects the gate from papering over failures', () => {
  const template = read('.github/pull_request_template.md');
  assert.match(template, /pnpm check.*green/iu);
  assert.match(template, /No test was weakened or skipped/iu);
  assert.match(template, /pnpm demo.*green/iu);
});
