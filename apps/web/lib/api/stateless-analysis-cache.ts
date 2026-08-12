import { createHash } from 'node:crypto';

import { Redis } from '@upstash/redis';

import { analyzeSpeech } from '../analyzer.ts';
import {
  StatelessAnalysisResponseSchema,
  type StatelessAnalysisRequest,
  type StatelessAnalysisResponse,
} from '../contracts.ts';

const CACHE_PREFIX = 'talk-active:analysis:v1:';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface StatelessAnalysisCacheStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
}

interface CacheOptions {
  environment?: NodeJS.ProcessEnv;
  store?: StatelessAnalysisCacheStore;
}

let defaultStore: StatelessAnalysisCacheStore | null = null;

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
  input: Pick<StatelessAnalysisRequest, 'transcript' | 'rubricText'>,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ transcript: input.transcript, rubricText: input.rubricText }))
    .digest('hex');
  return `${CACHE_PREFIX}${digest}`;
}

export async function readCachedStatelessAnalysis(
  input: StatelessAnalysisRequest,
  options: CacheOptions = {},
): Promise<StatelessAnalysisResponse | null> {
  const store = options.store ?? configuredStore(options.environment ?? process.env);
  if (!store) return null;
  try {
    const cached = StatelessAnalysisResponseSchema.safeParse(
      await store.get(statelessAnalysisCacheKey(input)),
    );
    if (!cached.success) return null;
    const delivery = analyzeSpeech({
      transcript: input.transcript,
      rubricText: input.rubricText,
      durationSeconds: input.durationSeconds,
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
  const store = options.store ?? configuredStore(options.environment ?? process.env);
  if (!store) return;
  try {
    await store.set(
      statelessAnalysisCacheKey(input),
      StatelessAnalysisResponseSchema.parse({ ...response, cached: false }),
      { ex: CACHE_TTL_SECONDS },
    );
  } catch {
    // Caching is a latency and cost optimization. A cache outage must not hide
    // an already-grounded review or replace the deterministic fallback path.
  }
}
