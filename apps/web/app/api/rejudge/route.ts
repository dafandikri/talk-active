import { NextResponse } from 'next/server';

import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { aiRequestDeadline } from '@/lib/ai/deadline';
import { parseJson, withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import { StatelessRejudgeRequestSchema } from '@/lib/contracts';
import { rejudgeStatelessEvidence } from '@/lib/services/stateless-review';

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, StatelessRejudgeRequestSchema);
  const userId = await optionalUserId(request);
  await enforceAiRateLimit(request, 'confirmation', userId);
  const deadlineAt = aiRequestDeadline();
  return NextResponse.json(await rejudgeStatelessEvidence(input, {
    evidence: { deadlineAt },
    question: { deadlineAt },
  }));
});
