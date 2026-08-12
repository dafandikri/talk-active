import { NextResponse } from 'next/server';
import { z } from 'zod';

import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { parseJson, withApiErrors } from '@/lib/api/http';
import { DefenseRequestSchema } from '@/lib/contracts';
import { optionalUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { evaluateAttemptDefense } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const input = await parseJson(request, DefenseRequestSchema);
  const userId = await optionalUserId(request);
  await enforceAiRateLimit(request, 'defense', userId);
  return NextResponse.json(await evaluateAttemptDefense(getDatabase(), attemptId, input, {}, userId));
});
