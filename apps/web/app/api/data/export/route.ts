import { NextResponse } from 'next/server';

import { withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import { exportOwnedWorkspace } from '@/lib/services/workspace';

export const GET = withApiErrors(async (request: Request) => {
  const userId = await requireUserId(request);
  const payload = await exportOwnedWorkspace(getDatabase(), userId);
  return NextResponse.json(payload, {
    headers: { 'content-disposition': 'attachment; filename="talk-active-export.json"' },
  });
});
