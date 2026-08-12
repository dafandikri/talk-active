import { NextResponse } from 'next/server';

import {
  CONTRACT_VERSION,
  HealthResponseSchema,
} from '@/lib/contracts';

export function GET() {
  const payload = HealthResponseSchema.parse({
    status: 'ready',
    contractVersion: CONTRACT_VERSION,
  });
  return NextResponse.json(payload);
}
