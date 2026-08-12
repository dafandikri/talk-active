import { connection } from 'next/server';
import { NextResponse } from 'next/server';

import { aiRateLimitConfigured } from '@/lib/api/ai-rate-limit';
import {
  CapabilitiesResponseSchema,
  CONTRACT_VERSION,
} from '@/lib/contracts';

export async function GET() {
  await connection();
  const semanticAvailable = aiRateLimitConfigured();
  return NextResponse.json(CapabilitiesResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    persistence: process.env.DATABASE_URL?.trim() ? 'neon' : 'local',
    accounts: Boolean(
      process.env.DATABASE_URL?.trim() && process.env.BETTER_AUTH_SECRET?.trim(),
    ),
    sourceDocuments: Boolean(
      process.env.DATABASE_URL?.trim() && process.env.BLOB_READ_WRITE_TOKEN?.trim(),
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
