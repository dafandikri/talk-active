import { z } from 'zod';

import { withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { readAttemptRecording } from '@/lib/services/attempt-recordings';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  const requestedRange = request.headers.get('range') ?? undefined;
  const result = await readAttemptRecording(
    getDatabase(),
    attemptId,
    userId,
    requestedRange,
  );
  const headers = new Headers();
  for (const name of ['accept-ranges', 'content-length', 'content-range', 'etag', 'last-modified']) {
    const value = result.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('content-type', result.contentType);
  headers.set('cache-control', 'private, no-store');
  headers.set('content-disposition', 'inline');
  headers.set('x-content-type-options', 'nosniff');
  const status = requestedRange && headers.has('content-range') ? 206 : 200;
  return new Response(result.stream, { status, headers });
});
