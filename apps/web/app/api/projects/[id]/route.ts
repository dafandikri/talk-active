import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { UpdateProjectRequestSchema } from '@/lib/contracts';
import { getDatabase } from '@/lib/db/client';
import { getOwnedProjectById, updateOwnedProject } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withApiErrors(async (request: Request, context: RouteContext) => {
  // Authenticate before parsing route input so every anonymous request gets
  // the same guest boundary instead of an input-dependent 400/401 response.
  const userId = await requireUserId(request);
  const { id: rawId } = await context.params;
  const projectId = z.uuid().parse(rawId);
  return NextResponse.json(await getOwnedProjectById(getDatabase(), projectId, userId));
});

export const PATCH = withApiErrors(async (request: Request, context: RouteContext) => {
  const userId = await requireUserId(request);
  const { id: rawId } = await context.params;
  const projectId = z.uuid().parse(rawId);
  const input = await parseJson(request, UpdateProjectRequestSchema);
  return NextResponse.json(await updateOwnedProject(getDatabase(), projectId, input, userId));
});
