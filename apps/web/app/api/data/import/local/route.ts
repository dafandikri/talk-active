import { NextResponse } from 'next/server';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { LegacyWorkspaceImportSchema } from '@/lib/contracts';
import { getDatabase } from '@/lib/db/client';
import { importLegacyWorkspace } from '@/lib/services/workspace';

export const POST = withApiErrors(async (request: Request) => {
  const workspace = await parseJson(request, LegacyWorkspaceImportSchema);
  const userId = await requireUserId(request);
  return NextResponse.json(await importLegacyWorkspace(getDatabase(), userId, workspace), { status: 201 });
});
