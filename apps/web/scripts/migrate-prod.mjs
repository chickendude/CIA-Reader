// Production migration runner. The prod web service's startup command
// invokes this before `node build/index.js`, so a fresh deploy applies
// any pending migrations against the live DB and then boots.
//
// Uses drizzle-orm's built-in migrator instead of drizzle-kit so the
// production image doesn't need to ship dev tooling.
//
// DATABASE_URL is required. The migration files live in
// apps/web/drizzle/ inside the runtime image (copied from the build
// stage by Dockerfile.prod).

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('migrate-prod: DATABASE_URL is required');
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client);

console.log('migrate-prod: applying migrations from apps/web/drizzle');
try {
  await migrate(db, { migrationsFolder: 'apps/web/drizzle' });
  console.log('migrate-prod: done');
} finally {
  await client.end();
}
