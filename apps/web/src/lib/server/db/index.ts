import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DATABASE_URL } from '../env.js';
import * as schema from './schema.js';

// Single shared connection pool across all server handlers.
const client = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
});

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
