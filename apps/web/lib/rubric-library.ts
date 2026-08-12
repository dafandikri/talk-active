import { z } from 'zod';

const TemplateCriterionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  requiredEvidence: z.array(z.string().trim().min(1).max(80)).min(2).max(12),
});

export const RubricTemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  name: z.string().trim().min(1).max(80),
  context: z.string().trim().min(1).max(160),
  criteria: z.array(TemplateCriterionSchema).min(3).max(8),
});

export type RubricTemplate = z.infer<typeof RubricTemplateSchema>;

export const RUBRIC_TEMPLATES: RubricTemplate[] = z.array(RubricTemplateSchema).parse([
  {
    id: 'hackathon-pitch',
    name: 'Hackathon pitch',
    context: 'A solution pitch judged on problem, novelty, feasibility, and impact.',
    criteria: [
      { name: 'Problem and user', description: 'Make the affected user, problem, and urgency explicit.', requiredEvidence: ['user', 'problem', 'evidence', 'urgency'] },
      { name: 'Solution alignment', description: 'Connect the proposed mechanism directly to the stated problem.', requiredEvidence: ['solution', 'mechanism', 'problem', 'workflow'] },
      { name: 'Differentiation', description: 'Compare the mechanism with a credible alternative.', requiredEvidence: ['alternative', 'comparison', 'different', 'why'] },
      { name: 'Feasibility', description: 'Show how the team can build and operate the solution.', requiredEvidence: ['architecture', 'timeline', 'cost', 'team'] },
      { name: 'Impact', description: 'State who benefits and how the outcome would be observed.', requiredEvidence: ['beneficiary', 'outcome', 'measure', 'scale'] },
    ],
  },
  {
    id: 'thesis-defense',
    name: 'Skripsi defense',
    context: 'A research defense where claims must remain bounded by the study.',
    criteria: [
      { name: 'Research problem', description: 'State the research gap, context, and question.', requiredEvidence: ['research gap', 'context', 'research question'] },
      { name: 'Method fit', description: 'Explain why the chosen method answers the question.', requiredEvidence: ['method', 'sample', 'procedure', 'why'] },
      { name: 'Evidence and analysis', description: 'Connect findings to the underlying data and analysis.', requiredEvidence: ['finding', 'data', 'analysis', 'result'] },
      { name: 'Limitations', description: 'Name what the study cannot establish or generalise.', requiredEvidence: ['limitation', 'boundary', 'bias', 'cannot'] },
      { name: 'Contribution', description: 'Explain the bounded practical or academic contribution.', requiredEvidence: ['contribution', 'implication', 'benefit', 'next step'] },
    ],
  },
  {
    id: 'scholarship-interview',
    name: 'Scholarship interview',
    context: 'A selection interview requiring specific motivation, evidence, and future impact.',
    criteria: [
      { name: 'Motivation', description: 'Connect the scholarship to a concrete personal and academic direction.', requiredEvidence: ['motivation', 'goal', 'experience', 'why now'] },
      { name: 'Program fit', description: 'Show why this program and institution fit the stated goal.', requiredEvidence: ['program', 'curriculum', 'institution', 'fit'] },
      { name: 'Leadership evidence', description: 'Support leadership claims with one specific action and result.', requiredEvidence: ['situation', 'action', 'team', 'result'] },
      { name: 'Impact plan', description: 'Describe who benefits after the study and how.', requiredEvidence: ['beneficiary', 'plan', 'outcome', 'measure'] },
      { name: 'Reflection and integrity', description: 'Address setbacks, trade-offs, and personal responsibility directly.', requiredEvidence: ['challenge', 'decision', 'lesson', 'responsibility'] },
    ],
  },
  {
    id: 'pkm-presentation',
    name: 'PKM presentation',
    context: 'A student innovation presentation with a proposal, implementation, and measured outcome.',
    criteria: [
      { name: 'Need and beneficiary', description: 'Define the need and the people or environment affected.', requiredEvidence: ['need', 'beneficiary', 'evidence', 'urgency'] },
      { name: 'Novelty', description: 'Explain the new mechanism or application relative to alternatives.', requiredEvidence: ['novelty', 'alternative', 'difference', 'mechanism'] },
      { name: 'Implementation method', description: 'Make the activity sequence and responsibilities observable.', requiredEvidence: ['method', 'stage', 'role', 'timeline'] },
      { name: 'Feasibility and resources', description: 'Relate scope to available time, people, and budget.', requiredEvidence: ['scope', 'team', 'budget', 'risk'] },
      { name: 'Outcome and continuation', description: 'Show the current result and a realistic continuation path.', requiredEvidence: ['result', 'measure', 'learning', 'continuation'] },
    ],
  },
  {
    id: 'job-interview',
    name: 'Job interview',
    context: 'A role interview where claims should be backed by relevant examples.',
    criteria: [
      { name: 'Role fit', description: 'Connect relevant experience and skills to this role.', requiredEvidence: ['role', 'skill', 'experience', 'relevance'] },
      { name: 'Achievement evidence', description: 'Describe one contribution with an observable result.', requiredEvidence: ['situation', 'action', 'result', 'measure'] },
      { name: 'Problem solving', description: 'Explain how a difficult decision was reasoned through.', requiredEvidence: ['problem', 'option', 'decision', 'trade-off'] },
      { name: 'Collaboration', description: 'Show how work with others changed an outcome.', requiredEvidence: ['team', 'communication', 'conflict', 'outcome'] },
      { name: 'Motivation and questions', description: 'Name the role-specific motivation and what still needs clarification.', requiredEvidence: ['motivation', 'company', 'role', 'question'] },
    ],
  },
]);

export function templateRubricText(template: RubricTemplate): string {
  return template.criteria
    .map((criterion) => `${criterion.name} | ${criterion.requiredEvidence.join(', ')}`)
    .join('\n');
}
