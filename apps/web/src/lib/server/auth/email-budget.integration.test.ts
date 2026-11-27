// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { expect, it, vi } from 'vitest';
import type { DB } from '../db/index.js';
import * as schema from '../db/schema.js';

const state = vi.hoisted(() => ({ db: undefined as unknown as DB }));
vi.mock('../db/index.js', async () => ({
  get db() { return state.db; }, schema: await import('../db/schema.js'),
}));
vi.mock('../env.js', () => ({
  EMAIL_DAILY_LIMIT: 5, EMAIL_UNVERIFIED_DAILY_LIMIT: 2, EMAIL_PER_ACCOUNT_LIMIT: 2,
}));

const url = process.env.DATABASE_URL;
const local = url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);

it.skipIf(!local)('shares a rolling email budget across simultaneous requests and account deletion', async () => {
  const name = 'mail_test_' + randomUUID().replaceAll('-', '');
  const setup = postgres(url!, { max: 1 });
  const pool = postgres(url!, { max: 5, connection: { search_path: name } });
  try {
    await setup`create schema ${setup(name)}`;
    await pool`create table users (id uuid primary key, email_verified_at timestamptz)`;
    await pool`create table magic_links (id text primary key, user_id uuid references users on delete cascade,
      created_at timestamptz default now(), expires_at timestamptz, consumed_at timestamptz)`;
    const signup = randomUUID(), reader = randomUUID(), other = randomUUID(), previous = randomUUID();
    await pool`insert into users ${pool([signup, reader, other, previous].map(id => ({ id })))}`;
    await pool`insert into magic_links(id,user_id) values ('previous-send',${previous})`;
    const migration = await readFile(new URL('../../../../drizzle/0076_account_email_attempts.sql', import.meta.url), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) await pool.unsafe(statement);
    state.db = drizzle(pool, { schema });
    const { createMagicLink } = await import('./magic-link.js');

    // The migrated send and the winning request fill the unverified pool.
    const burst = await Promise.all(Array.from({ length: 6 }, () => createMagicLink(signup, false)));
    expect(burst.filter(Boolean)).toHaveLength(1);
    await pool`delete from users where id=${signup}`;
    expect(await createMagicLink(other, false)).toBeNull();
    const signins = await Promise.all(Array.from({ length: 4 }, () => createMagicLink(reader, true)));
    expect(signins.filter(Boolean)).toHaveLength(2);
    expect(await createMagicLink(other, true)).toBeTruthy();
    expect(await createMagicLink(other, true)).toBeNull();
    expect(await pool`select count(*)::int as n from account_email_attempts`).toMatchObject([{ n: 5 }]);

    await pool`update account_email_attempts set created_at=now()-interval '25 hours' where user_id=${previous}`;
    expect(await createMagicLink(other, false)).toBeTruthy();
    expect(await pool`select count(*)::int as n from account_email_attempts`).toMatchObject([{ n: 5 }]);
  } finally {
    await pool.end();
    await setup`drop schema if exists ${setup(name)} cascade`;
    await setup.end();
  }
});
