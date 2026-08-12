import { toNextJsHandler } from 'better-auth/next-js';
import { NextResponse } from 'next/server';

import { ApiErrorSchema, CONTRACT_VERSION } from '@/lib/contracts';

function configured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim() && process.env.BETTER_AUTH_SECRET?.trim());
}

function unavailable() {
  return NextResponse.json(ApiErrorSchema.parse({
    contractVersion: CONTRACT_VERSION,
    error: {
      code: 'accounts_unavailable',
      message: 'Account sync is not configured. Continue in local guest mode.',
      retryable: false,
    },
  }), { status: 503 });
}

async function handler(request: Request, method: 'GET' | 'POST') {
  if (!configured()) return unavailable();
  const { auth } = await import('@/lib/auth');
  const handlers = toNextJsHandler(auth);
  return handlers[method](request);
}

export function GET(request: Request) {
  return handler(request, 'GET');
}

export function POST(request: Request) {
  return handler(request, 'POST');
}
