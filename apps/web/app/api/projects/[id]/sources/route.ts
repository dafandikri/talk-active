import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiProblem, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { getDatabase } from '@/lib/db/client';
import {
  createProjectSourceDocument,
  listProjectSourceDocuments,
} from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const projectId = z.uuid().parse(id);
  const userId = await requireUserId(request);
  return NextResponse.json(await listProjectSourceDocuments(getDatabase(), projectId, userId));
});

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id } = await context.params;
  const projectId = z.uuid().parse(id);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiProblem(400, 'invalid_form_data', 'Upload one source document as multipart form data.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new ApiProblem(400, 'source_document_required', 'Choose one source document to upload.');
  }
  const userId = await requireUserId(request);
  return NextResponse.json(await createProjectSourceDocument(
    getDatabase(),
    projectId,
    file,
    userId,
  ));
});
