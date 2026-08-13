import { NextResponse } from 'next/server';
import { z } from 'zod';

import { enforceAiRateLimit } from '@/lib/api/ai-rate-limit';
import { aiRequestDeadline } from '@/lib/ai/deadline';
import { parseJson, withApiErrors } from '@/lib/api/http';
import { requireUserId } from '@/lib/auth-session';
import { EvidenceConfirmationRequestSchema } from '@/lib/contracts';
import { getDatabase } from '@/lib/db/client';
import { confirmAttemptEvidence } from '@/lib/services/workspace';

interface RouteContext {
  params: Promise<{ id: string; criterionId: string }>;
}

export const POST = withApiErrors(async (request: Request, context: RouteContext) => {
  const { id, criterionId: rawCriterionId } = await context.params;
  const attemptId = z.uuid().parse(id);
  const criterionId = z.uuid().parse(rawCriterionId);
  const input = await parseJson(request, EvidenceConfirmationRequestSchema);
  const userId = await requireUserId(request);
  if (!input.accepted) await enforceAiRateLimit(request, 'confirmation', userId);
  return NextResponse.json(await confirmAttemptEvidence(
    getDatabase(),
    attemptId,
    criterionId,
    input,
    { deadlineAt: aiRequestDeadline() },
    userId,
  ));
});
