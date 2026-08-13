import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { RecordingFinalizeRequestSchema } from '@/lib/contracts';
import { getDatabase } from '@/lib/db/client';
import { finalizeAttemptRecording } from '@/lib/services/attempt-recordings';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  const input = await parseJson(request, RecordingFinalizeRequestSchema);
  return NextResponse.json(await finalizeAttemptRecording(
    getDatabase(),
    attemptId,
    input,
    userId,
  ));
});
