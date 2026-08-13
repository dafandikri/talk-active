import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { RecordingInitRequestSchema } from '@/lib/contracts';
import { getDatabase } from '@/lib/db/client';
import { deleteAttemptRecording, initializeAttemptRecording } from '@/lib/services/attempt-recordings';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  const input = await parseJson(request, RecordingInitRequestSchema);
  return NextResponse.json(
    await initializeAttemptRecording(getDatabase(), attemptId, input, userId),
    { status: 201 },
  );
});

export const DELETE = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  return NextResponse.json(await deleteAttemptRecording(getDatabase(), attemptId, userId));
});
