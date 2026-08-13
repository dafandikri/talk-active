import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const AI_UNITS = [
  'apps/web/lib/ai/evidence-judge.ts',
  'apps/web/lib/ai/rubric-parser.ts',
  'apps/web/lib/ai/question-generator.ts',
];

test('A-2 model units use AI SDK structured outputs with described Zod contracts', async () => {
  for (const relative of AI_UNITS) {
    const source = await readFile(relative, 'utf8');
    assert.match(source, /generateText\(\{/u, `${relative} must use the AI SDK generation flow`);
    assert.match(source, /Output\.object\(\{/u, `${relative} must request a schema-validated object`);
    assert.match(source, /schema:\s*[A-Za-z]+(?:Output)?Schema/u, `${relative} must pass its Zod schema to Output.object`);
    assert.match(source, /description:\s*['`]/u, `${relative} must describe the generated object to the provider`);
    assert.match(source, /\.describe\(/u, `${relative} must describe fields, not rely on property names alone`);
    assert.match(source, /TRUST BOUNDARY/u, `${relative} must keep quoted user material outside the instruction boundary`);
    assert.match(source, /OUTPUT POLICY/u, `${relative} must state the structured-output policy in its system prompt`);
  }
});

test('A-2 evidence reasoning is generated before verdict fields and discarded before persistence', async () => {
  const evidence = await readFile('apps/web/lib/ai/evidence-judge.ts', 'utf8');
  const schemaStart = evidence.indexOf('EvidenceJudgeOutputSchema');
  const reasoning = evidence.indexOf('reasoning:', schemaStart);
  const verdict = evidence.indexOf('verdict:', schemaStart);
  const publicJudgment = evidence.indexOf('export interface EvidenceJudgment');
  const judgmentEnd = evidence.indexOf('}', publicJudgment);

  assert.ok(reasoning > schemaStart && reasoning < verdict,
    'reasoning must be emitted before the classification fields');
  assert.doesNotMatch(evidence.slice(publicJudgment, judgmentEnd), /reasoning/u,
    'internal model reasoning must be dropped before verdict persistence');
});
