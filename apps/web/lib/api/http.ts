import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiErrorSchema, CONTRACT_VERSION } from '../contracts';
import { ApiProblem } from './problem';

export { ApiProblem } from './problem';

export function notFound(resource: string): never {
  throw new ApiProblem(404, 'not_found', `${resource} was not found.`);
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiProblem(400, 'invalid_json', 'The request body must be valid JSON.');
  }
  return schema.parse(body);
}

export function apiFailure(error: unknown): NextResponse {
  const problem = error instanceof ApiProblem
    ? error
    : error instanceof z.ZodError
      ? new ApiProblem(400, 'invalid_request', error.issues[0]?.message ?? 'The request is invalid.')
      : new ApiProblem(500, 'internal_error', 'The request could not be completed.', true);

  const payload = ApiErrorSchema.parse({
    contractVersion: CONTRACT_VERSION,
    error: {
      code: problem.code,
      message: problem.message,
      retryable: problem.retryable,
    },
  });
  return NextResponse.json(payload, { status: problem.status, headers: problem.headers });
}

export function withApiErrors<Arguments extends unknown[]>(
  handler: (...args: Arguments) => Promise<Response>,
): (...args: Arguments) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return apiFailure(error);
    }
  };
}
