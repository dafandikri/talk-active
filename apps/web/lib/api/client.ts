import { z } from 'zod';

import { ApiErrorSchema } from '../contracts';

export async function requestContract<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, init);
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
