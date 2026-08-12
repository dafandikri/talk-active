import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { ApiProblem } from './problem.ts';

export type AiRateLimitRoute = 'rubric' | 'analysis' | 'evidence' | 'question' | 'defense' | 'confirmation';

export interface AiRateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  reason?: 'timeout' | 'cacheBlock' | 'denyList';
}

export interface AiRateLimitStore {
  limit(route: AiRateLimitRoute, identifier: string, cost: number): Promise<AiRateLimitResult>;
}

interface EnforceOptions {
  environment?: NodeJS.ProcessEnv;
  store?: AiRateLimitStore;
  now?: () => number;
  cost?: number;
}

export interface AiRateLimitDecision {
  applied: boolean;
  identitiesChecked: number;
}

export const AI_RATE_LIMIT_ROUTE_COST: Readonly<Record<AiRateLimitRoute, number>> = {
  rubric: 2,
  analysis: 42,
  // A persistent attempt may contain 20 criteria and each schema/grounding
  // failure gets one corrective retry.
  evidence: 40,
  question: 2,
  defense: 2,
  // Stateless rejection performs one corrective re-judge and may use two
  // schema/grounding attempts to refresh its question.
  confirmation: 3,
};

const MODEL_ENVIRONMENT: Readonly<Record<AiRateLimitRoute, readonly string[]>> = {
  rubric: ['AI_RUBRIC_MODEL'],
  analysis: ['AI_EVIDENCE_MODEL', 'AI_QUESTION_MODEL'],
  evidence: ['AI_EVIDENCE_MODEL'],
  question: ['AI_QUESTION_MODEL'],
  defense: ['AI_DEFENSE_MODEL', 'AI_EVIDENCE_MODEL'],
  confirmation: ['AI_EVIDENCE_MODEL', 'AI_QUESTION_MODEL'],
};

const DEFAULT_REFILL_TOKENS = 20;
const DEFAULT_MAX_TOKENS = 50;
const RATE_LIMIT_INTERVAL = '10 m' as const;
const RATE_LIMIT_TIMEOUT_MS = 1_000;
const VERCEL_FIREWALL_MODE = 'vercel-firewall';

function configuredValue(environment: NodeJS.ProcessEnv, key: string): string | null {
  return environment[key]?.trim() || null;
}

function positiveIntegerSetting(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = configuredValue(environment, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10_000) {
    throw new Error(`${key} must be an integer between 1 and 10000.`);
  }
  return parsed;
}

export function aiRouteUsesModel(
  route: AiRateLimitRoute,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return MODEL_ENVIRONMENT[route].some((key) => Boolean(configuredValue(environment, key)));
}

export function statelessAnalysisRateLimitCost(
  criterionCount: number,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  if (!Number.isSafeInteger(criterionCount) || criterionCount < 1 || criterionCount > 20) {
    throw new Error('criterionCount must be an integer between 1 and 20.');
  }
  const evidenceCalls = configuredValue(environment, 'AI_EVIDENCE_MODEL')
    ? criterionCount * 2
    : 0;
  const questionCalls = configuredValue(environment, 'AI_QUESTION_MODEL') ? 2 : 0;
  return Math.max(1, evidenceCalls + questionCalls);
}

export function evidenceRateLimitCost(
  criterionCount: number,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  if (!Number.isSafeInteger(criterionCount) || criterionCount < 1 || criterionCount > 20) {
    throw new Error('criterionCount must be an integer between 1 and 20.');
  }
  return configuredValue(environment, 'AI_EVIDENCE_MODEL')
    ? criterionCount * 2
    : 1;
}

export function aiRateLimitConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (
    configuredValue(environment, 'AI_RATE_LIMIT_MODE') === VERCEL_FIREWALL_MODE
    && configuredValue(environment, 'VERCEL') === '1'
  ) return true;

  const secret = configuredValue(environment, 'AI_RATE_LIMIT_HASH_SECRET');
  if (
    !configuredValue(environment, 'UPSTASH_REDIS_REST_URL')
    || !configuredValue(environment, 'UPSTASH_REDIS_REST_TOKEN')
    || !secret
    || secret.length < 32
  ) return false;
  try {
    const refill = positiveIntegerSetting(
      environment,
      'AI_RATE_LIMIT_REFILL_TOKENS',
      DEFAULT_REFILL_TOKENS,
    );
    const maximum = positiveIntegerSetting(
      environment,
      'AI_RATE_LIMIT_MAX_TOKENS',
      DEFAULT_MAX_TOKENS,
    );
    return maximum >= Math.max(refill, ...Object.values(AI_RATE_LIMIT_ROUTE_COST));
  } catch {
    return false;
  }
}

function requestIp(request: Request): string | null {
  // Vercel overwrites these headers at its edge. Prefer its dedicated copy so
  // a reverse proxy cannot silently replace the platform-derived address.
  const raw = request.headers.get('x-vercel-forwarded-for')
    ?? request.headers.get('x-forwarded-for')
    ?? request.headers.get('x-real-ip');
  const candidate = raw?.split(',')[0]?.trim() ?? '';
  return isIP(candidate) ? candidate : null;
}

function pseudonymousIdentifier(kind: 'ip' | 'user', value: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex');
  return `${kind}:${digest}`;
}

function retryAfterSeconds(reset: number, currentTime: number): number {
  return Math.max(1, Math.ceil((reset - currentTime) / 1_000));
}

class UpstashAiRateLimitStore implements AiRateLimitStore {
  private readonly limiters = new Map<AiRateLimitRoute, Ratelimit>();
  private readonly redis: Redis;
  private readonly refillTokens: number;
  private readonly maxTokens: number;

  constructor(environment: NodeJS.ProcessEnv) {
    const url = configuredValue(environment, 'UPSTASH_REDIS_REST_URL');
    const token = configuredValue(environment, 'UPSTASH_REDIS_REST_TOKEN');
    if (!url || !token) throw new Error('Upstash Redis credentials are missing.');
    this.refillTokens = positiveIntegerSetting(
      environment,
      'AI_RATE_LIMIT_REFILL_TOKENS',
      DEFAULT_REFILL_TOKENS,
    );
    this.maxTokens = positiveIntegerSetting(
      environment,
      'AI_RATE_LIMIT_MAX_TOKENS',
      DEFAULT_MAX_TOKENS,
    );
    if (this.maxTokens < Math.max(this.refillTokens, ...Object.values(AI_RATE_LIMIT_ROUTE_COST))) {
      throw new Error('AI_RATE_LIMIT_MAX_TOKENS must cover the refill and highest route cost.');
    }
    this.redis = new Redis({ url, token, enableTelemetry: false });
  }

  async limit(
    route: AiRateLimitRoute,
    identifier: string,
    cost: number,
  ): Promise<AiRateLimitResult> {
    let limiter = this.limiters.get(route);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.tokenBucket(this.refillTokens, RATE_LIMIT_INTERVAL, this.maxTokens),
        prefix: `talk-active:ai-rate:v1:${route}`,
        analytics: false,
        timeout: RATE_LIMIT_TIMEOUT_MS,
      });
      this.limiters.set(route, limiter);
    }
    return limiter.limit(identifier, { rate: cost });
  }
}

let defaultStore: AiRateLimitStore | null = null;

function rateLimitStore(environment: NodeJS.ProcessEnv): AiRateLimitStore {
  // Production environment is immutable for one serverless isolate. Tests pass
  // an explicit store and never share this process-level client.
  defaultStore ??= new UpstashAiRateLimitStore(environment);
  return defaultStore;
}

function unavailable(message: string): never {
  throw new ApiProblem(503, 'ai_rate_limit_unavailable', message, true);
}

export async function enforceAiRateLimit(
  request: Request,
  route: AiRateLimitRoute,
  userId: string | null,
  options: EnforceOptions = {},
): Promise<AiRateLimitDecision> {
  const environment = options.environment ?? process.env;
  if (!aiRouteUsesModel(route, environment)) {
    return { applied: false, identitiesChecked: 0 };
  }
  if (!aiRateLimitConfigured(environment)) {
    unavailable('Semantic analysis is unavailable because its private rate limiter is not configured.');
  }
  if (
    configuredValue(environment, 'AI_RATE_LIMIT_MODE') === VERCEL_FIREWALL_MODE
    && configuredValue(environment, 'VERCEL') === '1'
  ) {
    // The production operator explicitly attests that Vercel Firewall checks
    // /api traffic by its platform-derived IP and JA4 fingerprint before this
    // function runs. VERCEL=1 prevents the flag from silently bypassing the
    // in-process limiter in local or non-Vercel deployments.
    return { applied: true, identitiesChecked: 1 };
  }
  const ip = requestIp(request);
  if (!ip) {
    unavailable('Semantic analysis is unavailable because this request could not be assigned a rate-limit identity.');
  }
  const secret = configuredValue(environment, 'AI_RATE_LIMIT_HASH_SECRET');
  if (!secret) unavailable('Semantic analysis is unavailable because its rate-limit identity secret is missing.');

  const identifiers = [pseudonymousIdentifier('ip', ip, secret)];
  if (userId) identifiers.push(pseudonymousIdentifier('user', userId, secret));
  const cost = options.cost ?? AI_RATE_LIMIT_ROUTE_COST[route];
  if (!Number.isSafeInteger(cost) || cost < 1 || cost > AI_RATE_LIMIT_ROUTE_COST[route]) {
    throw new Error(`Rate-limit cost for ${route} must be between 1 and ${AI_RATE_LIMIT_ROUTE_COST[route]}.`);
  }
  let results: AiRateLimitResult[];
  try {
    const store = options.store ?? rateLimitStore(environment);
    results = await Promise.all(identifiers.map((identifier) => store.limit(
      route,
      identifier,
      cost,
    )));
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    unavailable('Semantic analysis is temporarily unavailable because its rate limiter could not be reached.');
  }
  if (results.some((result) => result.reason === 'timeout')) {
    unavailable('Semantic analysis is temporarily unavailable because its rate limiter timed out.');
  }
  const blocked = results.filter((result) => !result.success)
    .sort((left, right) => right.reset - left.reset)[0];
  if (blocked) {
    const seconds = retryAfterSeconds(blocked.reset, options.now?.() ?? Date.now());
    throw new ApiProblem(
      429,
      'ai_rate_limit_exceeded',
      `Too many ${route} requests. Try again in ${seconds} seconds.`,
      true,
      { 'retry-after': String(seconds) },
    );
  }
  return { applied: true, identitiesChecked: identifiers.length };
}
