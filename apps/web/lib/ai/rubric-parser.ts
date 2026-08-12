import type { GatewayLanguageModelOptions } from '@ai-sdk/gateway';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';

import {
  CONTRACT_VERSION,
  ParsedCriterionSchema,
  RubricParseResponseSchema,
  type RubricParseResponse,
} from '../contracts.ts';
import { parseRubric } from '../analyzer.ts';
import { normaliseForGrounding } from '../grounding.ts';

const RubricModelOutputSchema = z.object({
  criteria: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000),
    requiredEvidence: z.array(z.string().trim().min(1).max(200)).max(40),
    sourceExcerpt: z.string().trim().min(1).max(2_000),
  })).min(1).max(20),
});

type RubricModelOutput = z.infer<typeof RubricModelOutputSchema>;

export interface GenerateRubricRequest {
  model: string;
  fallbackModels: string[];
  rubricText: string;
  correction: string | null;
  abortSignal: AbortSignal;
}

export type GenerateRubric = (
  request: GenerateRubricRequest,
) => Promise<{ output: unknown; modelId: string | null }>;

export interface RubricParserOptions {
  generate?: GenerateRubric;
  model?: string;
  fallbackModels?: string[];
  timeoutMs?: number;
}

class UntraceableCriterionError extends Error {
  readonly excerpt: string;

  constructor(excerpt: string) {
    super('A parsed criterion does not trace to the supplied rubric.');
    this.name = 'UntraceableCriterionError';
    this.excerpt = excerpt;
  }
}

function listFromEnvironment(name: string): string[] {
  return String(process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildRubricPrompt(rubricText: string, correction: string | null): string {
  return `Structure the supplied rubric into criteria a student can review before saving.

Rules:
- Use only criteria present in the source. Never add a "best practice" criterion.
- sourceExcerpt must be an exact, contiguous quote from the source for that criterion.
- Keep official names and weights in the name or description when supplied.
- requiredEvidence names observable evidence, not personality traits or ability scores.
${correction ? `\nVALIDATOR CORRECTION:\n${correction}\n` : ''}
RUBRIC SOURCE:
${rubricText}`;
}

async function generateWithAiSdk(
  request: GenerateRubricRequest,
): Promise<{ output: unknown; modelId: string | null }> {
  const gatewayOptions = {
    zeroDataRetention: true,
    tags: ['rubric-parser', 'contract-v1'],
    ...(request.fallbackModels.length > 0 ? { models: request.fallbackModels } : {}),
  } satisfies GatewayLanguageModelOptions;
  const result = await generateText({
    model: request.model,
    output: Output.object({ schema: RubricModelOutputSchema, name: 'parsed_rubric' }),
    system: 'You structure user-supplied evaluation rubrics without adding criteria.',
    prompt: buildRubricPrompt(request.rubricText, request.correction),
    abortSignal: request.abortSignal,
    providerOptions: { gateway: gatewayOptions },
  });
  return { output: result.output, modelId: result.response.modelId ?? request.model };
}

function traceAndShape(output: unknown, rubricText: string): RubricModelOutput {
  const parsed = RubricModelOutputSchema.parse(output);
  const source = normaliseForGrounding(rubricText);
  for (const criterion of parsed.criteria) {
    if (!source.includes(normaliseForGrounding(criterion.sourceExcerpt))) {
      throw new UntraceableCriterionError(criterion.sourceExcerpt);
    }
  }
  return parsed;
}

function responseFromModel(
  output: RubricModelOutput,
  mode: 'semantic' | 'deterministic',
  model: string | null,
): RubricParseResponse {
  return RubricParseResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    criteria: output.criteria.map((criterion, displayOrder) => ParsedCriterionSchema.parse({
      ...criterion,
      clientId: `criterion-${displayOrder + 1}`,
      displayOrder,
    })),
    mode,
    model,
    requiresConfirmation: true,
  });
}

function deterministicResponse(rubricText: string): RubricParseResponse {
  const lines = rubricText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const parsed = parseRubric(rubricText);
  return responseFromModel({
    criteria: parsed.map((criterion, index) => ({
      name: criterion.label,
      description: criterion.requirementText,
      requiredEvidence: criterion.signals,
      sourceExcerpt: lines[index] ?? criterion.label,
    })),
  }, 'deterministic', null);
}

function correctionFor(error: unknown): string | null {
  if (error instanceof UntraceableCriterionError) {
    return `The excerpt "${error.excerpt}" was not found in the supplied source. Quote it verbatim.`;
  }
  if (error instanceof z.ZodError || NoObjectGeneratedError.isInstance(error)) {
    return 'The previous response did not satisfy the criterion schema.';
  }
  return null;
}

export async function parseRubricWithSemantics(
  rubricText: string,
  options: RubricParserOptions = {},
): Promise<RubricParseResponse> {
  // Validate limits and empty input before any paid call.
  parseRubric(rubricText);
  const model = options.model ?? process.env.AI_RUBRIC_MODEL?.trim() ?? '';
  if (!model) return deterministicResponse(rubricText);

  const generate = options.generate ?? generateWithAiSdk;
  const fallbackModels = options.fallbackModels ?? listFromEnvironment('AI_RUBRIC_FALLBACK_MODELS');
  const timeoutMs = options.timeoutMs ?? positiveInteger(process.env.AI_RUBRIC_TIMEOUT_MS, 12_000);
  let correction: string | null = null;

  for (const attempt of [1, 2] as const) {
    try {
      const generated = await generate({
        model,
        fallbackModels,
        rubricText,
        correction,
        abortSignal: AbortSignal.timeout(timeoutMs),
      });
      return responseFromModel(traceAndShape(generated.output, rubricText), 'semantic', generated.modelId ?? model);
    } catch (error) {
      correction = correctionFor(error);
      if (!correction || attempt === 2) return deterministicResponse(rubricText);
    }
  }
  return deterministicResponse(rubricText);
}
