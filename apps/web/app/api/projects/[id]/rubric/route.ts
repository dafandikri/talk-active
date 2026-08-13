import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { ConfirmRubricRequestSchema } from '@/lib/contracts';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { confirmProjectRubric } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PUT = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const projectId = z.uuid().parse(id);
  const input = await parseJson(request, ConfirmRubricRequestSchema);
  const userId = await requireUserId(request);
  return NextResponse.json(await confirmProjectRubric(getDatabase(), projectId, input, userId));
});
