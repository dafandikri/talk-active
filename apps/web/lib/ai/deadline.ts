export const DEFAULT_AI_REQUEST_DEADLINE_MS = 28_000;
export const MAX_AI_REQUEST_DEADLINE_MS = 30_000;

function positiveDeadline(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_AI_REQUEST_DEADLINE_MS
    ? parsed
    : DEFAULT_AI_REQUEST_DEADLINE_MS;
}

/** A single wall-clock deadline shared by every model unit in one API request. */
export function aiRequestDeadline(
  environment: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now,
): number {
  return now() + positiveDeadline(environment.AI_REQUEST_DEADLINE_MS);
}

/** Bound an individual provider attempt by both its own timeout and the request budget. */
export function signalWithinDeadline(
  attemptTimeoutMs: number,
  deadlineAt: number | undefined,
  now: () => number = Date.now,
): AbortSignal {
  const remainingMs = deadlineAt === undefined
    ? attemptTimeoutMs
    : Math.max(1, deadlineAt - now());
  return AbortSignal.timeout(Math.max(1, Math.min(attemptTimeoutMs, remainingMs)));
}
