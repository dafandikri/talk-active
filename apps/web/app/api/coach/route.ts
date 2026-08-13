import { NextResponse } from 'next/server';

import { ClaimCoachUnavailableError, coachCriteria } from '@/lib/ai/claim-coach';
import { aiRequestDeadline } from '@/lib/ai/deadline';
import { coachRateLimitCost, enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { ApiProblem, parseJson, withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import {
  ClaimCoachRequestSchema,
  ClaimCoachResponseSchema,
  CONTRACT_VERSION,
} from '@/lib/contracts';

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, ClaimCoachRequestSchema);
  const userId = await optionalUserId(request);
  await enforceAiRateLimit(request, 'coach', userId, {
    cost: coachRateLimitCost(input.criteria.length),
  });
  try {
    const coachings = await coachCriteria(
      input.transcript,
      input.criteria.map((criterion) => ({ ...criterion, rubricId: 'stateless-analysis' })),
      { deadlineAt: aiRequestDeadline() },
    );
    return NextResponse.json(ClaimCoachResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      coachings,
    }));
  } catch (error) {
    // Separating a claim from its support is a judgement. There is no honest
    // rule-based imitation, so an unconfigured coach is a stated condition
    // rather than a quietly weaker answer (INV-7).
    if (error instanceof ClaimCoachUnavailableError) {
      throw new ApiProblem(503, 'coach_unavailable', error.message, false);
    }
    throw error;
  }
});
