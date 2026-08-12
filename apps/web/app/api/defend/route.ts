import { NextResponse } from 'next/server';

import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { aiRequestDeadline } from '@/lib/ai/deadline';
import { parseJson, withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import { StatelessDefenseRequestSchema } from '@/lib/contracts';
import { evaluateStatelessDefense } from '@/lib/services/stateless-review';

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, StatelessDefenseRequestSchema);
  const userId = await optionalUserId(request);
  await enforceAiRateLimit(request, 'defense', userId);
  return NextResponse.json(await evaluateStatelessDefense(input, {
    deadlineAt: aiRequestDeadline(),
  }));
});
