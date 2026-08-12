import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';

import { createDatabase } from './db/client';
import * as schema from './db/schema';

function requiredEnvironment(name: 'DATABASE_URL' | 'BETTER_AUTH_SECRET'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required before account sync can start.`);
  return value;
}

export const auth = betterAuth({
  database: drizzleAdapter(createDatabase(requiredEnvironment('DATABASE_URL')), {
    provider: 'pg',
    schema,
  }),
  secret: requiredEnvironment('BETTER_AUTH_SECRET'),
  baseURL: process.env.BETTER_AUTH_URL?.trim() || undefined,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  advanced: {
    cookiePrefix: 'talkactive',
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});
