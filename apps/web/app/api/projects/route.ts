import { NextResponse } from 'next/server';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { CreateProjectRequestSchema } from '@/lib/contracts';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { createOwnedProject, listOwnedProjects } from '@/lib/services/workspace';

// Listing requires the same synced identity as creating. Guest project rows
// historically used user_id = NULL, and SQL NULL is not an owner identity: a
// route that accepted an anonymous caller here would be one query away from
// showing one visitor another visitor's workspace. Callers treat the 401 as
// "no synced projects" and fall back to the local workspace, which is what a
// signed-out visitor actually has.
export const GET = withApiErrors(async (request: Request) => {
  const userId = await requireUserId(request);
  return NextResponse.json(await listOwnedProjects(getDatabase(), userId));
});

export const POST = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, CreateProjectRequestSchema);
  const userId = await requireUserId(request);
  return NextResponse.json(await createOwnedProject(getDatabase(), input, userId), { status: 201 });
});
