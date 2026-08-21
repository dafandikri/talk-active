import { connection } from 'next/server';
import { NextResponse } from 'next/server';

import { aiRateLimitConfigured } from '@/lib/api/ai-rate-limit';
import {
  CapabilitiesResponseSchema,
  CONTRACT_VERSION,
} from '@/lib/contracts';
import { optionalUserId } from '@/lib/auth-session';
import { semanticCredentialSuspect } from '@/lib/ai/semantic-health';

export async function GET(request: Request) {
  await connection();
  // Configuration says the tier was asked for; observed health says it can
  // still answer. A credential that has already been seen rejecting calls
  // withdraws the claim, so the interface stops offering a tier that cannot
  // run. This narrows the window rather than closing it — see semantic-health.
  const semanticAvailable = aiRateLimitConfigured() && !semanticCredentialSuspect();
  const databaseAvailable = Boolean(process.env.DATABASE_URL?.trim());
  const accountsAvailable = Boolean(
    databaseAvailable && process.env.BETTER_AUTH_SECRET?.trim(),
  );
  const userId = accountsAvailable ? await optionalUserId(request) : null;
  return NextResponse.json(CapabilitiesResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    // Neon is an account-only capability. An anonymous visitor has no stable,
    // private SQL owner identity, so their rehearsal remains local/stateless.
    persistence: databaseAvailable && userId ? 'neon' : 'local',
    accounts: accountsAvailable,
    sourceDocuments: Boolean(
      databaseAvailable && userId && process.env.BLOB_READ_WRITE_TOKEN?.trim(),
    ),
    recordings: Boolean(
      process.env.DATABASE_URL?.trim()
      && process.env.BLOB_READ_WRITE_TOKEN?.trim()
      && process.env.BETTER_AUTH_SECRET?.trim(),
    ),
    semantic: {
      rubric: semanticAvailable && Boolean(process.env.AI_RUBRIC_MODEL?.trim()),
      evidence: semanticAvailable && Boolean(process.env.AI_EVIDENCE_MODEL?.trim()),
      question: semanticAvailable && Boolean(process.env.AI_QUESTION_MODEL?.trim()),
      defense: semanticAvailable && Boolean(
        process.env.AI_DEFENSE_MODEL?.trim() || process.env.AI_EVIDENCE_MODEL?.trim(),
      ),
      coach: semanticAvailable && Boolean(
        process.env.AI_COACH_MODEL?.trim() || process.env.AI_EVIDENCE_MODEL?.trim(),
      ),
    },
  }));
}
