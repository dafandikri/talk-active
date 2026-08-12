import { NextResponse } from 'next/server';
import { z } from 'zod';

import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { aiRequestDeadline } from '@/lib/ai/deadline';
import { withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { createAttemptQuestion } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  await enforceAiRateLimit(request, 'question', userId);
  return NextResponse.json(await createAttemptQuestion(
    getDatabase(),
    attemptId,
    { deadlineAt: aiRequestDeadline() },
    userId,
  ));
});
