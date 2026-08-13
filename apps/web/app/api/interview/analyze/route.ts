import { NextResponse } from 'next/server';

import {
  enforceAiRateLimit,
  statelessAnalysisRateLimitCost,
} from '@/lib/api/ai-rate-limit';
import { aiRequestDeadline } from '@/lib/ai/deadline';
import { parseJson, withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import { InterviewAnalysisRequestSchema } from '@/lib/contracts';
import { analyzeInterview } from '@/lib/services/interview-analysis';

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, InterviewAnalysisRequestSchema);
  const userId = await optionalUserId(request);
  await enforceAiRateLimit(request, 'analysis', userId, {
    cost: statelessAnalysisRateLimitCost(input.turns.length),
  });
  const deadlineAt = aiRequestDeadline();
  return NextResponse.json(await analyzeInterview(input, {
    evidenceOptions: { deadlineAt },
    questionOptions: { deadlineAt },
  }));
});
