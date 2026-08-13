import { connection } from 'next/server';
import { NextResponse } from 'next/server';

import { aiRateLimitConfigured } from '@/lib/api/ai-rate-limit';
import {
  CapabilitiesResponseSchema,
  CONTRACT_VERSION,
} from '@/lib/contracts';
import { optionalUserId } from '@/lib/auth-session';

export async function GET(request: Request) {
  await connection();
  const semanticAvailable = aiRateLimitConfigured();
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
    },
  }));
}
