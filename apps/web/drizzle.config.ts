import { defineConfig } from 'drizzle-kit';

/**
 * `db:generate` writes migration SQL from the schema. Applying it needed a
 * connection and there was none here, so the nine files in ./drizzle had no
 * supported way to reach a database — the runbook for enabling accounts would
 * have stopped at "and then somehow run these".
 *
 * The URL is read at call time and never committed. `drizzle-kit migrate`
 * fails loudly without it, which is the correct behaviour: silently migrating
 * the wrong database is worse than not migrating.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
