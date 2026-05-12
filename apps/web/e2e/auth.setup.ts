/**
 * Authentication setup for Playwright e2e tests.
 *
 * Avoids the brittleness of logging in via the UI by minting a
 * session row directly in the dev Postgres for the seeded test user
 * (`crush@test.local`), then saving the resulting cookie to
 * `e2e/.auth/crush.json` for downstream specs to load via
 * `storageState`. The token shape matches the runtime: SHA-256 of
 * the cookie value is stored in `sessions.id`, raw token is the
 * cookie. See `src/lib/server/auth/sessions.ts` for the production
 * helpers; we duplicate the minimum here to avoid pulling in
 * SvelteKit at test-runtime.
 */
import { test as setup, expect } from '@playwright/test';
import postgres from 'postgres';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const AUTH_FILE = 'e2e/.auth/crush.json';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';
const TEST_EMAIL = 'crush@test.local';
// Matches the runtime cookie name + path (src/lib/server/auth/sessions.ts).
const SESSION_COOKIE = 'cia_session';

setup('mint a session for the seeded test user', async ({ baseURL }) => {
  const url = new URL(baseURL ?? 'http://localhost:5173');
  const sql = postgres(DATABASE_URL);
  try {
    const rows = await sql<Array<{ id: string }>>`
      SELECT id FROM users WHERE email = ${TEST_EMAIL} LIMIT 1
    `;
    const user = rows[0];
    expect(
      user,
      `seed user ${TEST_EMAIL} not found — run the dev DB bootstrap first`,
    ).toBeDefined();

    const token = randomBytes(32).toString('base64url');
    const id = createHash('sha256').update(token).digest('hex');
    // 30 days — plenty for a test run.
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await sql`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${id}, ${user!.id}, ${expiresAt})
    `;

    const storage = {
      cookies: [
        {
          name: SESSION_COOKIE,
          value: token,
          domain: url.hostname,
          path: '/',
          expires: Math.floor(expiresAt.getTime() / 1000),
          httpOnly: true,
          secure: url.protocol === 'https:',
          sameSite: 'Lax' as const,
        },
      ],
      origins: [],
    };
    await mkdir(dirname(AUTH_FILE), { recursive: true });
    await writeFile(AUTH_FILE, JSON.stringify(storage, null, 2));
  } finally {
    await sql.end();
  }
});
