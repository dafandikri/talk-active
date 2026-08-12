import { NextResponse } from 'next/server';

import { parseRubricWithSemantics } from '@/lib/ai/rubric-parser';
import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { parseJson, withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import { RubricParseRequestSchema } from '@/lib/contracts';

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, RubricParseRequestSchema);
  const userId = await optionalUserId(request);
  await enforceAiRateLimit(request, 'rubric', userId);
  return NextResponse.json(await parseRubricWithSemantics(input.rubricText));
});
