import { NextResponse } from 'next/server';

import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import {
  readCachedStatelessAnalysis,
  writeCachedStatelessAnalysis,
} from '@/lib/api/stateless-analysis-cache';
import { parseJson, withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import { StatelessAnalysisRequestSchema } from '@/lib/contracts';
import { analyzeStatelessAttempt } from '@/lib/services/stateless-analysis';

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, StatelessAnalysisRequestSchema);
  const cached = await readCachedStatelessAnalysis(input);
  if (cached) return NextResponse.json(cached);

  const userId = await optionalUserId(request);
  await enforceAiRateLimit(request, 'analysis', userId);
  const response = await analyzeStatelessAttempt(input);
  await writeCachedStatelessAnalysis(input, response);
  return NextResponse.json(response);
});
