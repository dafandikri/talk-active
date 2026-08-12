import { NextResponse } from 'next/server';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { CreateProjectRequestSchema } from '@/lib/contracts';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { createOwnedProject } from '@/lib/services/workspace';

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, CreateProjectRequestSchema);
  const userId = await requireUserId(request);
  return NextResponse.json(await createOwnedProject(getDatabase(), input, userId), { status: 201 });
});
