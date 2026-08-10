#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SCRIPT_PATH));
const RUBRIC_PATH = 'docs/rubrics/2026-finals.json';
const READINESS_PATH = 'docs/finals-readiness.json';
const ALLOWED_STATUSES = new Set(['pending', 'ready', 'verified', 'blocked']);

const EXPECTED_CRITERIA = new Map([
  ['FP-PROBLEM', ['Problem Identification', 15, 15, 'final-product']],
  ['FP-SOLUTION', ['Solution Alignment', 15, 15, 'final-product']],
  ['FP-INNOVATION', ['Innovation & Uniqueness', 10, 15, 'final-product']],
  ['FP-TECHNICAL', ['Technical Execution', 30, 15, 'final-product']],
  ['FP-DESIGN', ['Design & User Experience', 10, 15, 'final-product']],
  ['PP-PITCH-QA', ['Pitching and Q&A Response', 20, 15, 'product-presentation']],
  ['EX-BOOTH', ['Booth & Visual Display', 20, 16, 'booth-exhibition']],
  ['EX-DEMO', ['Interactive Demo & Prototype', 30, 16, 'booth-exhibition']],
  ['EX-COMMUNICATION', ['Communication & Engagement', 30, 16, 'booth-exhibition']],
  ['EX-IMPACT', ['Product Impact & Innovation', 20, 16, 'booth-exhibition']],
]);

const EXPECTED_REQUIREMENTS = [
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
  'TM-DAY5-001',
  'TM-DAY5-002',
  'TM-OPEN-001',
  'TM-OPEN-002',
];

function quoted(value) {
  return JSON.stringify(String(value));
}

function displayPath(value) {
  const home = homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function load(relative) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${relative}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function uniqueIds(items, key, label, errors) {
  const ids = items.map((item) => item?.[key]).filter((id) => typeof id === 'string');
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) errors.push([`${label}-duplicates`, `duplicate IDs: ${duplicates.join(', ')}`]);
  return ids;
}

function sameMembers(actual, expected) {
  return actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function model(rubric, readiness) {
  const scorecards = Array.isArray(rubric.scorecards) ? rubric.scorecards : [];
  const surfaces = scorecards.flatMap((scorecard) => (
    Array.isArray(scorecard.surfaces)
      ? scorecard.surfaces.map((surface) => ({ ...surface, scorecardId: scorecard.id }))
      : []
  ));
  const criteria = surfaces.flatMap((surface) => (
    Array.isArray(surface.criteria)
      ? surface.criteria.map((criterion) => ({ ...criterion, surfaceId: surface.id, scorecardId: surface.scorecardId }))
      : []
  ));
  return {
    rubric,
    readiness,
    scorecards,
    surfaces,
    criteria,
    requirements: Array.isArray(rubric.requirements) ? rubric.requirements : [],
    criterionReadiness: Array.isArray(readiness.criteria) ? readiness.criteria : [],
    requirementReadiness: Array.isArray(readiness.requirements) ? readiness.requirements : [],
  };
}

function validate(rubric, readiness) {
  const data = model(rubric, readiness);
  const errors = [];

  if (rubric.schemaVersion !== 1) errors.push(['rubric-schema', 'schemaVersion must be 1']);
  if (rubric.id !== 'ristek-hackathon-2026-finals') errors.push(['rubric-id', 'unexpected rubric id']);
  if (rubric.totalPoints !== 200) errors.push(['rubric-total', 'combined finals total must be 200 points']);
  if (rubric.source?.record !== 'docs/TECHNICAL-MEETING-2026.md') errors.push(['rubric-source', 'rubric must cite the technical-meeting record']);
  if (!sameMembers(rubric.source?.officialScoringSlides ?? [], [15, 16])) errors.push(['rubric-slides', 'official scoring sources must be slides 15 and 16']);

  const scorecardIds = uniqueIds(data.scorecards, 'id', 'scorecard', errors);
  if (!sameMembers(scorecardIds, ['final-presentation', 'exhibition'])) errors.push(['scorecards', 'expected final-presentation and exhibition scorecards']);
  for (const scorecard of data.scorecards) {
    const surfaceTotal = (scorecard.surfaces ?? []).reduce((sum, surface) => sum + Number(surface.points ?? 0), 0);
    if (scorecard.points !== 100 || surfaceTotal !== 100) errors.push([`scorecard-${scorecard.id}`, `${scorecard.id} must allocate exactly 100 points`]);
  }

  const surfaceIds = uniqueIds(data.surfaces, 'id', 'surface', errors);
  if (!sameMembers(surfaceIds, ['final-product', 'product-presentation', 'booth-exhibition'])) errors.push(['surfaces', 'expected final-product, product-presentation, and booth-exhibition surfaces']);
  for (const surface of data.surfaces) {
    const criterionTotal = (surface.criteria ?? []).reduce((sum, criterion) => sum + Number(criterion.weight ?? 0), 0);
    if (criterionTotal !== surface.points) errors.push([`surface-${surface.id}`, `${surface.id} criteria sum to ${criterionTotal}, expected ${surface.points}`]);
  }

  const criterionIds = uniqueIds(data.criteria, 'id', 'criterion', errors);
  if (!sameMembers(criterionIds, [...EXPECTED_CRITERIA.keys()])) errors.push(['criteria', 'official criterion set drifted']);
  for (const criterion of data.criteria) {
    const expected = EXPECTED_CRITERIA.get(criterion.id);
    if (!expected) continue;
    const [title, weight, slide, surface] = expected;
    if (criterion.title !== title || criterion.weight !== weight || criterion.sourceSlide !== slide || criterion.surfaceId !== surface) {
      errors.push([`criterion-${criterion.id}`, `${criterion.id} must remain ${title} (${weight}) from slide ${slide} on ${surface}`]);
    }
    if (!Array.isArray(criterion.ownerTasks) || criterion.ownerTasks.length === 0) errors.push([`owner-${criterion.id}`, `${criterion.id} needs at least one owner task`]);
    if (!Array.isArray(criterion.acceptanceEvidence) || criterion.acceptanceEvidence.length === 0) errors.push([`evidence-${criterion.id}`, `${criterion.id} needs internal acceptance evidence`]);
  }

  const requirementIds = uniqueIds(data.requirements, 'id', 'requirement', errors);
  if (!sameMembers(requirementIds, EXPECTED_REQUIREMENTS)) errors.push(['requirements', 'technical-meeting requirement set drifted']);
  for (const requirement of data.requirements) {
    if (!surfaceIds.includes(requirement.surface)) errors.push([`requirement-${requirement.id}`, `${requirement.id} targets unknown surface ${requirement.surface}`]);
    if (typeof requirement.requirement !== 'string' || requirement.requirement.length < 20) errors.push([`requirement-text-${requirement.id}`, `${requirement.id} needs a concrete requirement`]);
  }

  if (readiness.schemaVersion !== 1) errors.push(['readiness-schema', 'readiness schemaVersion must be 1']);
  if (readiness.rubricId !== rubric.id) errors.push(['readiness-rubric', 'readiness ledger targets the wrong rubric']);
  if (!/^2026-\d{2}-\d{2}$/u.test(readiness.asOf ?? '')) errors.push(['readiness-date', 'readiness asOf must be a 2026 ISO date']);

  const criterionReadinessIds = uniqueIds(data.criterionReadiness, 'criterionId', 'criterion-readiness', errors);
  if (!sameMembers(criterionReadinessIds, criterionIds)) errors.push(['criterion-readiness', 'readiness must cover every criterion exactly once']);
  const requirementReadinessIds = uniqueIds(data.requirementReadiness, 'requirementId', 'requirement-readiness', errors);
  if (!sameMembers(requirementReadinessIds, requirementIds)) errors.push(['requirement-readiness', 'readiness must cover every requirement exactly once']);

  for (const [kind, entries] of [['criterion', data.criterionReadiness], ['requirement', data.requirementReadiness]]) {
    for (const entry of entries) {
      const id = entry.criterionId ?? entry.requirementId ?? 'unknown';
      if (!ALLOWED_STATUSES.has(entry.status)) errors.push([`${kind}-status-${id}`, `${id} has invalid status ${entry.status}`]);
      if (!Array.isArray(entry.evidence) || entry.evidence.some((item) => typeof item !== 'string' || item.length === 0)) errors.push([`${kind}-evidence-${id}`, `${id} evidence must be a list of non-empty strings`]);
      if (entry.status === 'verified' && entry.evidence.length === 0) errors.push([`${kind}-verified-${id}`, `${id} cannot be verified without evidence`]);
      if (typeof entry.note !== 'string' || entry.note.length === 0) errors.push([`${kind}-note-${id}`, `${id} needs an actionable note`]);
    }
  }

  return { data, errors };
}

function loadAndValidate() {
  const rubric = load(RUBRIC_PATH);
  const readiness = load(READINESS_PATH);
  return validate(rubric, readiness);
}

function renderErrors(errors) {
  return [
    `errors[${errors.length}]{id,detail}:`,
    ...errors.map(([id, detail]) => `  ${quoted(id)},${quoted(detail)}`),
  ];
}

function home() {
  const { data, errors } = loadAndValidate();
  if (errors.length > 0) return failValidation(errors);

  const criterionState = new Map(data.criterionReadiness.map((entry) => [entry.criterionId, entry.status]));
  const rows = data.surfaces.map((surface) => {
    const ids = surface.criteria.map((criterion) => criterion.id);
    const verified = ids.filter((id) => criterionState.get(id) === 'verified').length;
    return `  ${surface.id},${quoted(surface.title)},${surface.points},${verified}/${ids.length}`;
  });
  const verifiedRequirements = data.requirementReadiness.filter((entry) => entry.status === 'verified').length;

  process.stdout.write([
    `bin: ${quoted(displayPath(SCRIPT_PATH))}`,
    `description: ${quoted('Inspect and enforce RISTEK finals readiness against the official technical-meeting rubric')}`,
    'rubric:',
    `  id: ${data.rubric.id}`,
    `  source: ${quoted(data.rubric.source.record)}`,
    `  total-points: ${data.rubric.totalPoints}`,
    `surfaces[${rows.length}]{id,title,points,verified}:`,
    ...rows,
    'readiness:',
    `  criteria: ${data.criterionReadiness.filter((entry) => entry.status === 'verified').length}/${data.criteria.length} verified`,
    `  requirements: ${verifiedRequirements}/${data.requirements.length} verified`,
    `help[2]: ${quoted('pnpm finals')},${quoted('pnpm rubric --help')}`,
  ].join('\n') + '\n');
}

function check() {
  const { data, errors } = loadAndValidate();
  if (errors.length > 0) return failValidation(errors);
  process.stdout.write([
    'rubric-check:',
    '  status: passed',
    `  scorecards: ${data.scorecards.length}`,
    `  surfaces: ${data.surfaces.length}`,
    `  criteria: ${data.criteria.length}`,
    `  requirements: ${data.requirements.length}`,
  ].join('\n') + '\n');
}

function gate() {
  const { data, errors } = loadAndValidate();
  if (errors.length > 0) return failValidation(errors);

  const criterionSurface = new Map(data.criteria.map((criterion) => [criterion.id, criterion.surfaceId]));
  const requirementSurface = new Map(data.requirements.map((requirement) => [requirement.id, requirement.surface]));
  const gaps = [
    ...data.criterionReadiness
      .filter((entry) => entry.status !== 'verified')
      .map((entry) => ['criterion', entry.criterionId, criterionSurface.get(entry.criterionId), entry.status]),
    ...data.requirementReadiness
      .filter((entry) => entry.status !== 'verified')
      .map((entry) => ['requirement', entry.requirementId, requirementSurface.get(entry.requirementId), entry.status]),
  ];
  const total = data.criteria.length + data.requirements.length;
  const verified = total - gaps.length;

  process.stdout.write([
    'finals-gate:',
    `  status: ${gaps.length === 0 ? 'passed' : 'failed'}`,
    `  verified: ${verified}/${total}`,
    `gaps[${gaps.length}]{kind,id,surface,status}:`,
    ...gaps.map(([kind, id, surface, status]) => `  ${kind},${id},${surface},${status}`),
    ...(gaps.length > 0 ? [`help: ${quoted(`Update ${READINESS_PATH} with verified status and concrete evidence`)}`] : []),
  ].join('\n') + '\n');
  if (gaps.length > 0) process.exitCode = 1;
}

function help() {
  process.stdout.write([
    'command: finals-rubric',
    `description: ${quoted('Inspect the official finals rubric and gate evidence-backed readiness')}`,
    `usage: ${quoted('node scripts/finals-rubric.mjs [check|gate|--help]')}`,
    'commands[2]{name,purpose}:',
    `  check,${quoted('Validate official weights, surfaces, requirements, and readiness coverage')}`,
    `  gate,${quoted('Fail until every criterion and requirement is verified with evidence')}`,
    `examples[3]: ${quoted('pnpm rubric')},${quoted('pnpm rubric check')},${quoted('pnpm finals')}`,
  ].join('\n') + '\n');
}

function failValidation(errors) {
  process.stdout.write([
    'rubric-check:',
    '  status: failed',
    ...renderErrors(errors),
    `help: ${quoted(`Repair ${RUBRIC_PATH} or ${READINESS_PATH}`)}`,
  ].join('\n') + '\n');
  process.exitCode = 1;
}

function failUsage(command) {
  process.stdout.write([
    `error: ${quoted(`unknown command: ${command}`)}`,
    `help: ${quoted('Run `pnpm rubric --help` for available commands')}`,
  ].join('\n') + '\n');
  process.exitCode = 2;
}

function main() {
  try {
    const args = process.argv.slice(2);
    const command = args[0] === '--' ? args[1] : args[0];
    if (command === undefined) home();
    else if (command === 'check') check();
    else if (command === 'gate') gate();
    else if (command === '--help' || command === '-h' || command === 'help') help();
    else failUsage(command);
  } catch (error) {
    failValidation([['load', error instanceof Error ? error.message : String(error)]]);
  }
}

main();
