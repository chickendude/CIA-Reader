/**
 * Authentication + test-data setup for Playwright e2e tests.
 *
 * 1. Ensures the seeded test user (`crush@test.local`) exists.
 *    Local dev DBs have it from the bootstrap script; CI starts
 *    with an empty DB so we upsert it here. Admin role so it can
 *    do everything the reader / library tests need.
 * 2. Ensures a chapter-book collection with multiple multi-page
 *    chapters exists. The cross-text-nav + progress specs need
 *    real-looking content (consecutive chapters, at least one with
 *    enough words to span multiple display pages); a tiny seed
 *    keeps CI runs fast while still exercising the real paths.
 * 3. Mints a session row directly in the dev Postgres for that
 *    user, saving the cookie to `e2e/.auth/crush.json` for
 *    downstream specs to load via `storageState`. The token shape
 *    matches the runtime: SHA-256 of the cookie value is stored in
 *    `sessions.id`, raw token is the cookie.
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

/** Idempotent: return the existing user id if one is there, else
 *  insert. We don't set a password — the e2e tests never log in
 *  via the UI, they mint a session directly. `onboarded_at` is set
 *  so `hooks.server.ts` doesn't redirect every page to /onboarding
 *  (an unboarded user can't reach the reader at all). */
async function ensureTestUser(sql: postgres.Sql): Promise<string> {
  const existing = await sql<Array<{ id: string }>>`
    SELECT id FROM users WHERE email = ${TEST_EMAIL} LIMIT 1
  `;
  if (existing[0]) return existing[0].id;
  const inserted = await sql<Array<{ id: string }>>`
    INSERT INTO users (email, role, email_verified_at, onboarded_at)
    VALUES (${TEST_EMAIL}, 'admin', NOW(), NOW())
    RETURNING id
  `;
  return inserted[0]!.id;
}

/** Generate paragraphs of approximately `wordsPerParagraph` words,
 *  for `paragraphCount` paragraphs. Used to fill seed chapter bodies
 *  with enough content to span multiple display pages at the test
 *  viewport (800×600). */
function generateBody(paragraphCount: number, wordsPerParagraph: number): string {
  const wordPool = [
    'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
    'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore',
    'magna', 'aliqua', 'enim', 'minim', 'veniam', 'quis', 'nostrud',
    'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'commodo',
  ];
  const paragraphs: string[] = [];
  for (let p = 0; p < paragraphCount; p += 1) {
    const words: string[] = [];
    for (let w = 0; w < wordsPerParagraph; w += 1) {
      words.push(wordPool[(p * wordsPerParagraph + w) % wordPool.length]!);
    }
    paragraphs.push(words.join(' ') + '.');
  }
  return paragraphs.join('\n\n');
}

/** Idempotent: if the user already owns a chapter-book collection
 *  with at least one ready ≥800-word chapter, leave it alone.
 *  Otherwise create one with three chapters — two consecutive
 *  multi-page chapters (for the cross-text nav specs) and a short
 *  trailing chapter (so chapter-count assertions stay meaningful). */
async function ensureChapterBook(sql: postgres.Sql, ownerId: string): Promise<void> {
  const existing = await sql<Array<{ id: string }>>`
    SELECT c.id
    FROM collections c
    JOIN collection_items ci ON ci.collection_id = c.id
    JOIN texts t ON t.id = ci.text_id
    JOIN text_chapters tc ON tc.text_id = t.id
    WHERE c.owner_id = ${ownerId}
      AND c.kind = 'chapter_book'
      AND t.status = 'ready'
      AND tc.token_count >= 800
    LIMIT 1
  `;
  if (existing[0]) return;

  await sql.begin(async (tx) => {
    const [collection] = await tx<Array<{ id: string }>>`
      INSERT INTO collections (owner_id, language, kind, title, visibility)
      VALUES (${ownerId}, 'hi', 'chapter_book', 'E2E Test Book', 'private')
      RETURNING id
    `;
    const collectionId = collection!.id;

    const chapters = [
      { title: 'Chapter One — Intro', body: generateBody(8, 120) },
      { title: 'Chapter Two — Body', body: generateBody(10, 140) },
      { title: 'Chapter Three — Coda', body: generateBody(6, 100) },
    ];

    for (let i = 0; i < chapters.length; i += 1) {
      const c = chapters[i]!;
      const [text] = await tx<Array<{ id: string }>>`
        INSERT INTO texts (owner_id, language, title, source_type, status, visibility)
        VALUES (${ownerId}, 'hi', ${c.title}, 'zip', 'ready', 'private')
        RETURNING id
      `;
      const bodyWithTitle = `${c.title}\n\n${c.body}`;
      const tokenCount = bodyWithTitle.trim().split(/\s+/).length;
      await tx`
        INSERT INTO text_chapters (text_id, idx, title, body, token_count)
        VALUES (${text!.id}, 0, ${c.title}, ${bodyWithTitle}, ${tokenCount})
      `;
      await tx`
        INSERT INTO collection_items (collection_id, text_id, position)
        VALUES (${collectionId}, ${text!.id}, ${i})
      `;
    }
  });
}

setup('seed test data and mint a session', async ({ baseURL }) => {
  const url = new URL(baseURL ?? 'http://localhost:5173');
  const sql = postgres(DATABASE_URL);
  try {
    const userId = await ensureTestUser(sql);
    await ensureChapterBook(sql, userId);

    const token = randomBytes(32).toString('base64url');
    const id = createHash('sha256').update(token).digest('hex');
    // 30 days — plenty for a test run.
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await sql`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${id}, ${userId}, ${expiresAt})
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

    // Sanity check that the seed produced what downstream specs
    // need — if not, fail fast with a useful message rather than
    // letting the spec timeout looking for a chapter pair.
    const pair = await sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM collection_items ci
      JOIN texts t ON t.id = ci.text_id
      JOIN text_chapters tc ON tc.text_id = t.id
      JOIN collections c ON c.id = ci.collection_id
      WHERE c.owner_id = ${userId}
        AND c.kind = 'chapter_book'
        AND t.status = 'ready'
        AND tc.token_count >= 500
    `;
    expect(
      pair[0]?.count ?? 0,
      'seed should produce at least two ≥500-word chapters in a chapter book',
    ).toBeGreaterThanOrEqual(2);
  } finally {
    await sql.end();
  }
});
