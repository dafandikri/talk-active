import { createHash } from 'node:crypto';

import { Redis } from '@upstash/redis';

import { EVIDENCE_JUDGE_SYSTEM_PROMPT } from '../ai/evidence-judge.ts';
import { QUESTION_GENERATOR_SYSTEM_PROMPT } from '../ai/question-generator.ts';
import { analyzeSpeech } from '../analyzer.ts';
import {
  StatelessAnalysisResponseSchema,
  type StatelessAnalysisRequest,
  type StatelessAnalysisResponse,
} from '../contracts.ts';

const CACHE_PREFIX = 'talk-active:analysis:v2:';
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MEMORY_CACHE_MAX_ENTRIES = 50;

interface MemoryCacheEntry {
  expiresAt: number;
  response: StatelessAnalysisResponse;
}

export interface StatelessAnalysisCacheStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
}

interface CacheOptions {
  environment?: NodeJS.ProcessEnv;
  store?: StatelessAnalysisCacheStore;
}

let defaultStore: StatelessAnalysisCacheStore | null = null;
const memoryCache = new Map<string, MemoryCacheEntry>();

function configuredStore(environment: NodeJS.ProcessEnv): StatelessAnalysisCacheStore | null {
  const url = environment.UPSTASH_REDIS_REST_URL?.trim();
  const token = environment.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  if (!defaultStore) {
    const redis = new Redis({ url, token, enableTelemetry: false });
    defaultStore = {
      get: (key) => redis.get(key),
      set: (key, value, options) => redis.set(key, value, options),
    };
  }
  return defaultStore;
}

export function statelessAnalysisCacheKey(
  input: Pick<StatelessAnalysisRequest, 'transcript' | 'criteria' | 'language'>,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      transcript: input.transcript,
      criteria: [...input.criteria].sort((left, right) => left.displayOrder - right.displayOrder),
      // The response wording depends on this. The system prompts below are
      // hashed for the same reason, but the language directive rides in the
      // per-request user prompt, so nothing else here would separate two
      // projects that share a transcript and rubric.
      language: input.language,
      prompts: {
        evidence: EVIDENCE_JUDGE_SYSTEM_PROMPT,
        question: QUESTION_GENERATOR_SYSTEM_PROMPT,
      },
      models: {
        evidence: environment.AI_EVIDENCE_MODEL?.trim() ?? '',
        evidenceFallbacks: environment.AI_EVIDENCE_FALLBACK_MODELS?.trim() ?? '',
        question: environment.AI_QUESTION_MODEL?.trim() ?? '',
        questionFallbacks: environment.AI_QUESTION_FALLBACK_MODELS?.trim() ?? '',
      },
    }))
    .digest('hex');
  return `${CACHE_PREFIX}${digest}`;
}

export async function readCachedStatelessAnalysis(
  input: StatelessAnalysisRequest,
  options: CacheOptions = {},
): Promise<StatelessAnalysisResponse | null> {
  const environment = options.environment ?? process.env;
  const key = statelessAnalysisCacheKey(input, environment);
  const memoryEntry = options.store ? undefined : memoryCache.get(key);
  if (memoryEntry) {
    if (memoryEntry.expiresAt > Date.now()) {
      // Refresh insertion order so the bounded map behaves as an LRU cache.
      memoryCache.delete(key);
      memoryCache.set(key, memoryEntry);
      const delivery = analyzeSpeech({
        transcript: input.transcript,
        rubricText: input.criteria.map((criterion) => {
          const evidence = criterion.requiredEvidence.length > 0
            ? criterion.requiredEvidence.join(', ')
            : criterion.description.trim() || criterion.name;
          return `${criterion.name} | ${evidence}`;
        }).join('\n'),
        durationSeconds: input.durationSeconds,
        language: input.language,
      }).delivery;
      return StatelessAnalysisResponseSchema.parse({
        ...memoryEntry.response,
        analysis: { ...memoryEntry.response.analysis, delivery },
        cached: true,
      });
    }
    memoryCache.delete(key);
  }

  const store = options.store ?? configuredStore(environment);
  if (!store) return null;
  try {
    const cached = StatelessAnalysisResponseSchema.safeParse(
      await store.get(key),
    );
    if (!cached.success) return null;
    const delivery = analyzeSpeech({
      transcript: input.transcript,
      rubricText: input.criteria.map((criterion) => {
        const evidence = criterion.requiredEvidence.length > 0
          ? criterion.requiredEvidence.join(', ')
          : criterion.description.trim() || criterion.name;
        return `${criterion.name} | ${evidence}`;
      }).join('\n'),
      durationSeconds: input.durationSeconds,
      language: input.language,
    }).delivery;
    return StatelessAnalysisResponseSchema.parse({
      ...cached.data,
      analysis: { ...cached.data.analysis, delivery },
      cached: true,
    });
  } catch {
    return null;
  }
}

export async function writeCachedStatelessAnalysis(
  input: StatelessAnalysisRequest,
  response: StatelessAnalysisResponse,
  options: CacheOptions = {},
): Promise<void> {
  if (response.mode !== 'semantic') return;
  const environment = options.environment ?? process.env;
  const key = statelessAnalysisCacheKey(input, environment);
  const parsed = StatelessAnalysisResponseSchema.parse({ ...response, cached: false });
  if (!options.store) {
    memoryCache.delete(key);
    memoryCache.set(key, {
      expiresAt: Date.now() + CACHE_TTL_SECONDS * 1_000,
      response: parsed,
    });
    while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
      const oldestKey = memoryCache.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      memoryCache.delete(oldestKey);
    }
  }

  const store = options.store ?? configuredStore(environment);
  if (!store) return;
  try {
    await store.set(
      key,
      parsed,
      { ex: CACHE_TTL_SECONDS },
    );
  } catch {
    // Caching is a latency and cost optimization. A cache outage must not hide
    // an already-grounded review or replace the deterministic fallback path.
  }
}
