import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { SaveAttemptDeliveryReviewRequestSchema } from '@/lib/contracts';
import { getDatabase } from '@/lib/db/client';
import { getAttemptReview, saveAttemptDeliveryReview } from '@/lib/services/attempt-recordings';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  return NextResponse.json(await getAttemptReview(getDatabase(), attemptId, userId));
});

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  const input = await parseJson(request, SaveAttemptDeliveryReviewRequestSchema);
  return NextResponse.json(await saveAttemptDeliveryReview(getDatabase(), attemptId, input, userId));
});
