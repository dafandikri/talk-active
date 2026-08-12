import { NextResponse } from 'next/server';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { CreateAttemptRequestSchema } from '@/lib/contracts';
import { optionalUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { createPracticeAttempt } from '@/lib/services/workspace';

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, CreateAttemptRequestSchema);
  const userId = await optionalUserId(request);
  return NextResponse.json(await createPracticeAttempt(getDatabase(), input, userId), { status: 201 });
});
