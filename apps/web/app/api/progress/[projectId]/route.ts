import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { getProjectProgress } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export const GET = withApiErrors(async (_request: Request, context: RouteContext) => {
  const { projectId } = await context.params;
  const id = z.uuid().parse(projectId);
  const userId = await requireUserId(_request);
  return NextResponse.json(await getProjectProgress(getDatabase(), id, userId));
});
