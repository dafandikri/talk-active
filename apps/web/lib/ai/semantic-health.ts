/**
 * What the runtime has actually observed about the gateway credential.
 *
 * `/api/capabilities` used to answer "is semantic review available?" purely
 * from environment-variable presence. That answer was wrong for two days in
 * August 2026: the key had expired, every call returned 401, the analyzer
 * degraded to deterministic cue matching exactly as designed — and the
 * interface went on advertising a semantic tier that could not run.
 *
 * This records the one thing configuration cannot know: whether the credential
 * still works. It only ever *withdraws* a claim, and only after a real
 * authentication failure was seen, so it cannot invent a capability.
 *
 * BOUNDARY, stated rather than hidden: this is per-isolate memory, not shared
 * state. A cold serverless isolate begins trusting the configuration again, so
 * the first analysis after a cold start can still advertise a tier that is
 * already dead. It narrows the window; it does not close it. The gate that
 * closes it is `pnpm check:gateway`, which reads key expiry from outside the
 * runtime before a student ever meets the fallback.
 */

/** How long one observed authentication failure withdraws the semantic claim. */
export const SEMANTIC_CREDENTIAL_SUSPECT_TTL_MS = 5 * 60_000;

let authFailedAt: number | null = null;

/**
 * A dead gateway credential surfaces as a plain `Error` whose `name` is
 * `GatewayAuthenticationError`.
 *
 * The branded `GatewayAuthenticationError.isInstance()` helper cannot be used
 * here: the `ai` package bundles its own copy of `@ai-sdk/gateway`, so the
 * symbol the brand relies on differs between that copy and ours, and the check
 * returns false for genuine authentication errors. `name` is a plain string and
 * survives the package boundary. Verified against a revoked key on 21 August
 * 2026 — if this ever stops matching, the symptom is silent, so
 * `test/semantic-health.test.mjs` pins the observed shape.
 */
export function isGatewayAuthFailure(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'GatewayAuthenticationError';
}

export function recordSemanticAuthFailure(now: number = Date.now()): void {
  authFailedAt = now;
}

/** Any accepted model response proves the credential is alive again. */
export function recordSemanticSuccess(): void {
  authFailedAt = null;
}

export function semanticCredentialSuspect(now: number = Date.now()): boolean {
  if (authFailedAt === null) return false;
  return now - authFailedAt <= SEMANTIC_CREDENTIAL_SUSPECT_TTL_MS;
}

/** Test seam: module state outlives a single test without it. */
export function resetSemanticHealth(): void {
  authFailedAt = null;
}
