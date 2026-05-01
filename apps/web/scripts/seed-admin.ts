/**
 * Dev-only seeder for an admin (or other-role) user. Idempotent — if the
 * email already exists, password_hash + role are updated; otherwise a new
 * row is inserted with email_verified_at=NOW so login works immediately.
 *
 *   pnpm seed-admin user@example.com plainpassword
 *   pnpm seed-admin user@example.com plainpassword --role curator --name "Foo Bar"
 *
 * Reads DATABASE_URL from apps/web/.env (auto-loaded via the same
 * dotenv pattern used by import-dictionary).
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../src/lib/server/db/schema.js';
import { hashPassword } from '../src/lib/server/auth/password.js';

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';

const VALID_ROLES = ['user', 'curator', 'admin'] as const;
type Role = (typeof VALID_ROLES)[number];

function parseArgs(argv: string[]): {
  email: string;
  password: string;
  role: Role;
  displayName: string | null;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        throw new Error(`flag --${key} needs a value`);
      }
      flags[key] = val;
      i++;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length < 2) {
    throw new Error(
      'usage: pnpm seed-admin <email> <password> [--role user|curator|admin] [--name "Display Name"]',
    );
  }
  const role = (flags.role ?? 'admin') as Role;
  if (!(VALID_ROLES as readonly string[]).includes(role)) {
    throw new Error(`invalid --role "${role}"; must be one of ${VALID_ROLES.join(', ')}`);
  }
  return {
    email: positional[0],
    password: positional[1],
    role,
    displayName: flags.name ?? null,
  };
}

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const { email, password, role, displayName } = parsed;

const client = postgres(DATABASE_URL, { max: 1, idle_timeout: 5 });
const db = drizzle(client, { schema });

const passwordHash = await hashPassword(password);
const now = new Date();

const [row] = await db
  .insert(schema.users)
  .values({
    email,
    passwordHash,
    role,
    displayName,
    emailVerifiedAt: now,
  })
  .onConflictDoUpdate({
    target: schema.users.email,
    set: {
      passwordHash,
      role,
      updatedAt: now,
      // Preserve existing display_name when --name isn't supplied, so re-running
      // the script to rotate a password doesn't wipe the on-record name.
      ...(displayName !== null && { displayName }),
    },
  })
  .returning({
    id: schema.users.id,
    email: schema.users.email,
    role: schema.users.role,
    displayName: schema.users.displayName,
    emailVerifiedAt: schema.users.emailVerifiedAt,
  });

console.log('seeded user:', row);

await client.end();
