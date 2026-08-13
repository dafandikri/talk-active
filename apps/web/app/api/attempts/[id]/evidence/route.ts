import { NextResponse } from 'next/server';
import { z } from 'zod';

import { enforceAiRateLimit, evidenceRateLimitCost } from '@/lib/api/ai-rate-limit';
import { aiRequestDeadline } from '@/lib/ai/deadline';
import { withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { evaluateAttemptEvidence, getAttemptCriterionCount } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  const database = getDatabase();
  const criterionCount = await getAttemptCriterionCount(database, attemptId, userId);
  await enforceAiRateLimit(request, 'evidence', userId, {
    cost: evidenceRateLimitCost(criterionCount),
  });
  return NextResponse.json(await evaluateAttemptEvidence(
    database,
    attemptId,
    { deadlineAt: aiRequestDeadline() },
    userId,
  ));
});
