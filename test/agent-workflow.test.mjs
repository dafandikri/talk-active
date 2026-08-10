import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(join(ROOT, 'docs/AGENT-WORKFLOW.md'), 'utf8');
const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');

test('agent workflow keeps simple composable patterns as the default', () => {
  assert.match(workflow, /simplest pattern that fits/iu);
  assert.match(workflow, /prompt chaining with gates/iu);
  assert.match(workflow, /Complexity must earn itself/iu);
});

test('parallel workers have bounded ownership and an integration gate', () => {
  assert.match(workflow, /explicit file boundary/iu);
  assert.match(workflow, /stop condition/iu);
  assert.match(workflow, /orchestrator integrates and validates/iu);
  assert.match(workflow, /Workers do not merge themselves/iu);
});

test('agent completion is grounded in the environment and human control', () => {
  assert.match(workflow, /plan[^.]+is not ground truth/isu);
  assert.match(workflow, /browser-visible state/iu);
  assert.match(workflow, /pause at strategy checkpoints/iu);
  assert.match(workflow, /never infer permission to[\s\S]+commit[\s\S]+merge/iu);
});

test('canonical instructions point to the durable workflow', () => {
  assert.match(agents, /docs\/AGENT-WORKFLOW\.md/u);
});
