import { NextResponse } from 'next/server';

import { parseJson, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { DeleteAccountRequestSchema, DeleteAccountResponseSchema } from '@/lib/contracts';
import { getDatabase } from '@/lib/db/client';
import { deleteOwnedAccount } from '@/lib/services/workspace';

export const DELETE = withApiErrors(async (request: Request) => {
  const input = await parseJson(request, DeleteAccountRequestSchema);
  const userId = await requireUserId(request);
  const payload = DeleteAccountResponseSchema.parse(await deleteOwnedAccount(getDatabase(), userId));
  return NextResponse.json(payload);
});
