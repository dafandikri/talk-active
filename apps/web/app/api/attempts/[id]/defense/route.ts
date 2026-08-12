import { NextResponse } from 'next/server';
import { z } from 'zod';

import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { aiRequestDeadline } from '@/lib/ai/deadline';
import { parseJson, withApiErrors } from '@/lib/api/http';
import { DefenseRequestSchema } from '@/lib/contracts';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { evaluateAttemptDefense } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const input = await parseJson(request, DefenseRequestSchema);
  const userId = await requireUserId(request);
  await enforceAiRateLimit(request, 'defense', userId);
  return NextResponse.json(await evaluateAttemptDefense(
    getDatabase(),
    attemptId,
    input,
    { deadlineAt: aiRequestDeadline() },
    userId,
  ));
});
