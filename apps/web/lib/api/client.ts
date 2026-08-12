import { z } from 'zod';

import { ApiErrorSchema } from '../contracts';

export const CLIENT_REQUEST_TIMEOUT_MS = 35_000;

export async function requestContract<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(path, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted && !init?.signal?.aborted) {
      throw new Error('The analysis took too long. Your draft is still here; try again.');
    }
    throw error;
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = ApiErrorSchema.safeParse(body);
    throw new Error(problem.success ? problem.data.error.message : 'The server returned an invalid error response.');
  }
  return schema.parse(body);
}

export function jsonRequest(method: 'POST' | 'PUT' | 'DELETE', body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
