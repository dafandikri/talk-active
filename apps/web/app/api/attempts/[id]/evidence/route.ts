import { NextResponse } from 'next/server';
import { z } from 'zod';

import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { evaluateAttemptEvidence } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await optionalUserId(request);
  await enforceAiRateLimit(request, 'evidence', userId);
  return NextResponse.json(await evaluateAttemptEvidence(getDatabase(), attemptId, {}, userId));
});
