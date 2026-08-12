import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withApiErrors } from '@/lib/api/http';
import { optionalUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { deleteProjectSourceDocument } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string; sourceId: string }>;
}

export const DELETE = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id, sourceId: rawSourceId } = await context.params;
  const projectId = z.uuid().parse(id);
  const sourceId = z.uuid().parse(rawSourceId);
  const userId = await optionalUserId(request);
  return NextResponse.json(await deleteProjectSourceDocument(
    getDatabase(),
    projectId,
    sourceId,
    userId,
  ));
});
