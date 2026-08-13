import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiProblem, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import {
  authorizeAttemptRecordingUpload,
  completeAttemptRecordingFromUpload,
} from '@/lib/services/attempt-recordings';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const attemptId = z.uuid().parse(id);
  let body: HandleUploadBody;
  try {
    body = await request.json() as HandleUploadBody;
  } catch {
    throw new ApiProblem(400, 'invalid_json', 'The upload request body must be valid JSON.');
  }

  const response = await handleUpload({
    request,
    body,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      // Completion callbacks are authenticated by the signed Blob token and do
      // not carry the browser session. Only token issuance reads the session.
      const userId = await requireUserId(request);
      return authorizeAttemptRecordingUpload(
        getDatabase(),
        attemptId,
        userId,
        pathname,
        clientPayload,
      );
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      await completeAttemptRecordingFromUpload(getDatabase(), tokenPayload, blob);
    },
  });
  return NextResponse.json(response);
});
