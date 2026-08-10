import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const rubric = JSON.parse(read('docs/rubrics/2026-finals.json'));
const readiness = JSON.parse(read('docs/finals-readiness.json'));
const packageJson = JSON.parse(read('package.json'));
const scorecards = rubric.scorecards;
const surfaces = scorecards.flatMap((scorecard) => scorecard.surfaces);
const criteria = surfaces.flatMap((surface) => surface.criteria.map((criterion) => ({
  ...criterion,
  surfaceId: surface.id,
})));

const EXPECTED = [
  ['FP-PROBLEM', 'Problem Identification', 15, 15, 'final-product'],
  ['FP-SOLUTION', 'Solution Alignment', 15, 15, 'final-product'],
  ['FP-INNOVATION', 'Innovation & Uniqueness', 10, 15, 'final-product'],
  ['FP-TECHNICAL', 'Technical Execution', 30, 15, 'final-product'],
  ['FP-DESIGN', 'Design & User Experience', 10, 15, 'final-product'],
  ['PP-PITCH-QA', 'Pitching and Q&A Response', 20, 15, 'product-presentation'],
  ['EX-BOOTH', 'Booth & Visual Display', 20, 16, 'booth-exhibition'],
  ['EX-DEMO', 'Interactive Demo & Prototype', 30, 16, 'booth-exhibition'],
  ['EX-COMMUNICATION', 'Communication & Engagement', 30, 16, 'booth-exhibition'],
  ['EX-IMPACT', 'Product Impact & Innovation', 20, 16, 'booth-exhibition'],
];

function run(args = []) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts/finals-rubric.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('finals rubric preserves every official criterion, weight, source slide, and surface', () => {
  const actual = criteria.map((criterion) => [
    criterion.id,
    criterion.title,
    criterion.weight,
    criterion.sourceSlide,
    criterion.surfaceId,
  ]);
  assert.deepEqual(actual, EXPECTED);
  assert.deepEqual(
    surfaces.map((surface) => [surface.id, surface.points]),
    [['final-product', 80], ['product-presentation', 20], ['booth-exhibition', 100]],
  );
});

test('each official scorecard and evaluated surface allocates its full score', () => {
  assert.equal(rubric.totalPoints, 200);
  for (const scorecard of scorecards) {
    assert.equal(scorecard.points, 100, `${scorecard.id} must remain a 100-point scorecard`);
    assert.equal(
      scorecard.surfaces.reduce((sum, surface) => sum + surface.points, 0),
      scorecard.points,
      `${scorecard.id} surfaces do not allocate its full score`,
    );
  }
  for (const surface of surfaces) {
    assert.equal(
      surface.criteria.reduce((sum, criterion) => sum + criterion.weight, 0),
      surface.points,
      `${surface.id} criteria do not allocate its full score`,
    );
  }
});

test('every scoring criterion has ownership and evidence-backed acceptance obligations', () => {
  for (const criterion of criteria) {
    assert.ok(criterion.ownerTasks.length > 0, `${criterion.id} has no owner task`);
    assert.ok(criterion.acceptanceEvidence.length > 0, `${criterion.id} has no required proof`);
    assert.ok(
      criterion.acceptanceEvidence.every((item) => typeof item === 'string' && item.length >= 30),
      `${criterion.id} contains weak or empty acceptance evidence`,
    );
  }
  assert.match(
    rubric.source.note,
    /internal proof standard.*not.*organizer scoring guidance/iu,
    'internal acceptance evidence must not be misrepresented as organizer-authored descriptors',
  );
});

test('readiness ledger covers every criterion and technical-meeting requirement exactly once', () => {
  const criterionIds = criteria.map((criterion) => criterion.id).sort();
  const criterionReadinessIds = readiness.criteria.map((entry) => entry.criterionId).sort();
  const requirementIds = rubric.requirements.map((requirement) => requirement.id).sort();
  const requirementReadinessIds = readiness.requirements.map((entry) => entry.requirementId).sort();

  assert.deepEqual(criterionReadinessIds, criterionIds);
  assert.deepEqual(requirementReadinessIds, requirementIds);
  assert.equal(new Set(criterionReadinessIds).size, criterionReadinessIds.length);
  assert.equal(new Set(requirementReadinessIds).size, requirementReadinessIds.length);
  assert.equal(rubric.requirements.length, 18);
  assert.ok(requirementIds.includes('TM-OPEN-001'), 'file naming ambiguity must remain a blocking requirement');
  assert.ok(requirementIds.includes('TM-OPEN-002'), 'AI-assistance policy must remain a blocking requirement');
});

test('verified readiness can never be asserted without concrete evidence', () => {
  for (const entry of [...readiness.criteria, ...readiness.requirements]) {
    assert.ok(['pending', 'ready', 'verified', 'blocked'].includes(entry.status));
    assert.ok(Array.isArray(entry.evidence));
    if (entry.status === 'verified') {
      assert.ok(entry.evidence.length > 0, `${entry.criterionId ?? entry.requirementId} is verified without evidence`);
    }
  }
});

test('rubric CLI home is compact, structured, and exposes all three surfaces', () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^bin: /u);
  assert.match(result.stdout, /surfaces\[3\]\{id,title,points,verified\}:/u);
  assert.match(result.stdout, /final-product,"Final Product",80/u);
  assert.match(result.stdout, /product-presentation,"Product Presentation",20/u);
  assert.match(result.stdout, /booth-exhibition,"Booth Exhibition",100/u);
  assert.match(result.stdout, /requirements: 0\/18 verified/u);
});

test('rubric structural check passes while strict finals gate fails loudly on pending proof', () => {
  const check = run(['check']);
  assert.equal(check.status, 0);
  assert.equal(check.stderr, '');
  assert.match(check.stdout, /status: passed/u);
  assert.match(check.stdout, /criteria: 10/u);
  assert.match(check.stdout, /requirements: 18/u);

  const gate = run(['gate']);
  assert.equal(gate.status, 1);
  assert.equal(gate.stderr, '');
  assert.match(gate.stdout, /status: failed/u);
  assert.match(gate.stdout, /verified: 0\/28/u);
  assert.match(gate.stdout, /gaps\[28\]\{kind,id,surface,status\}:/u);
  assert.match(gate.stdout, /TM-OPEN-002,final-product,pending/u);
});

test('package scripts enforce rubric structure in development and evidence in finals', () => {
  assert.match(packageJson.scripts.check, /finals-rubric\.mjs check/u);
  assert.equal(packageJson.scripts.rubric, 'node scripts/finals-rubric.mjs');
  assert.equal(packageJson.scripts.finals, 'node scripts/finals-rubric.mjs gate');
});

test('rubric CLI usage errors are structured on stdout', () => {
  const result = run(['unknown']);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /error: "unknown command: unknown"/u);
  assert.match(result.stdout, /pnpm rubric --help/u);
});

test('rubric CLI tolerates an explicitly forwarded pnpm separator', () => {
  const result = run(['--', 'check']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /status: passed/u);
});
