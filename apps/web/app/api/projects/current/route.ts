import { NextResponse } from 'next/server';

import { withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { getCurrentOwnedProject } from '@/lib/services/workspace';

export const GET = withApiErrors(async (request: Request) => {
  const userId = await optionalUserId(request);
  return NextResponse.json(await getCurrentOwnedProject(getDatabase(), userId));
});
