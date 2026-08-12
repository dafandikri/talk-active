import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

import * as schema from './schema';

export function createDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required before opening a database connection.');
  }
  // The pooled driver supports interactive transactions. The HTTP driver does
  // not, and rubric replacement must never leave a half-written rubric behind.
  return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
}

export type Database = ReturnType<typeof createDatabase>;

let sharedDatabase: Database | undefined;

export function getDatabase(): Database {
  sharedDatabase ??= createDatabase();
  return sharedDatabase;
}
