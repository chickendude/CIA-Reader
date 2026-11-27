// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { expect, it, vi } from 'vitest';
import type { DB } from '../db/index.js';
import * as schema from '../db/schema.js';

const state = vi.hoisted(() => ({ db: undefined as unknown as DB }));
vi.mock('../db/index.js', async () => ({
  get db() { return state.db; }, schema: await import('../db/schema.js'),
}));

const url = process.env.DATABASE_URL;
const local = url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);

it.skipIf(!local)('enforces signup and password limits across concurrent callers, deletion, and expiry', async () => {
  const name = 'auth_test_' + randomUUID().replaceAll('-', '');
  const setup = postgres(url!, { max: 1 });
  const pool = postgres(url!, { max: 8, connection: { search_path: name } });
  try {
    await setup`create schema ${setup(name)}`;
    await pool`create table users (like public.users including all)`;
    await pool`create table user_networks (network text, signup_at timestamptz, last_seen_at timestamptz default now())`;
    const { networkKey, purgeExpiredAuthActivity } = await import('./user-networks.js');
    const previous = () => '192.0.2.1';
    await pool`insert into user_networks(network, signup_at) values (${networkKey(previous)}, now() - interval '5 hours')`;
    for (const file of ['0078_auth_attempt_limits', '0079_signup_retries']) {
      const migration = await readFile(new URL(`../../../../drizzle/${file}.sql`, import.meta.url), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint')) await pool.unsafe(statement);
    }
    state.db = drizzle(pool, { schema });
    const { registerAccount, checkPasswordLogin } = await import('./password-access.js');

    const origin = () => '192.0.2.2';
    const other = () => '192.0.2.3';
    const input = { email: 'reader@example.com', password: 'reader-password' };
    expect((await registerAccount(input, previous)).status).toBe('suppressed');
    const registrations = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      registerAccount({ ...input, email: i + input.email }, origin)));
    expect(registrations.filter(r => r.status === 'created')).toHaveLength(1);
    expect(registrations.filter(r => r.status === 'suppressed')).toHaveLength(5);
    await pool`delete from users`;
    expect((await registerAccount(input, origin)).status).toBe('suppressed');
    await pool`update signup_windows set expires_at=now() where network=${networkKey(origin)}`;
    expect((await registerAccount(input, origin)).status).toBe('created');
    expect((await registerAccount(input, other)).status).toBe('existing');
    expect((await registerAccount({ ...input, email: 'another@example.com' }, other)).status).toBe('created');

    const counters = await state.db.select().from(schema.signupRetries).orderBy(asc(schema.signupRetries.attempts));
    expect(counters).toMatchObject([
      { network: networkKey(previous), attempts: 1, lastAttemptAt: expect.any(Date) },
      { network: networkKey(origin), attempts: 6, lastAttemptAt: expect.any(Date) },
    ]);

    await pool`update signup_retries set day = day - 7 where network = ${networkKey(previous)}`;
    await purgeExpiredAuthActivity();
    expect(await pool`select attempts from signup_retries`).toEqual([{ attempts: 6 }]);

    // The same email shares one limit across addresses, including simultaneous requests.
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      checkPasswordLogin(input.email, 'wrong', () => '192.0.2.' + (i + 5))));
    expect(attempts.filter(r => r.status === 'invalid')).toHaveLength(5);
    expect(attempts.filter(r => r.status === 'limited')).toHaveLength(3);
    expect(await checkPasswordLogin(input.email, input.password, other)).toMatchObject({ status: 'limited' });
    await pool`update password_failures set expires_at = now()`;
    expect((await checkPasswordLogin(input.email, input.password, other)).status).toBe('authenticated');

    const spray = await Promise.all(Array.from({ length: 22 }, (_, i) =>
      checkPasswordLogin(i + '@example.com', 'wrong', origin)));
    expect(spray.filter(r => r.status === 'invalid')).toHaveLength(20);
    expect(spray.filter(r => r.status === 'limited')).toHaveLength(2);
    expect((await checkPasswordLogin(input.email, input.password, other)).status).toBe('authenticated');
  } finally {
    await pool.end();
    await setup`drop schema if exists ${setup(name)} cascade`;
    await setup.end();
  }
});
