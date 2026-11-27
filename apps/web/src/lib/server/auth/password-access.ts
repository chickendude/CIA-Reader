import { createHmac } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { AUTH_SECRET } from '../env.js';
import { hashPassword, verifyPassword } from './password.js';
import { networkKey } from './user-networks.js';

const now = sql`statement_timestamp()`;
const EMAIL_FAILURE_LIMIT = 5;
const NETWORK_FAILURE_LIMIT = 20;

function requestNetwork(getClientAddress: () => string) {
  const network = networkKey(getClientAddress);
  if (!network) error(503, 'Please try again later.');
  return network;
}

export async function registerAccount(
  input: { email: string; password: string; displayName?: string },
  getClientAddress: () => string,
) {
  const network = requestNetwork(getClientAddress);
  const { signupWindows, signupRetries, users } = schema;
  return db.transaction(async tx => {
    // Serialize signups from the same address across both registration endpoints.
    await tx.execute(sql`select pg_advisory_xact_lock(7801, hashtext(${network}))`);
    const active = await tx.$count(signupWindows, and(eq(signupWindows.network, network), gt(signupWindows.expiresAt, now)));
    if (active) {
      await tx.insert(signupRetries).values({ network }).onConflictDoUpdate({
        target: [signupRetries.day, signupRetries.network],
        set: { attempts: sql`${signupRetries.attempts} + 1`, lastAttemptAt: now },
      });
      return { status: 'suppressed' } as const;
    }
    if (await tx.$count(users, eq(users.email, input.email))) return { status: 'existing' } as const;

    const passwordHash = await hashPassword(input.password);
    const [user] = await tx.insert(users).values({
      email: input.email, displayName: input.displayName ?? null, passwordHash,
    }).onConflictDoNothing({ target: users.email }).returning();
    if (!user) return { status: 'existing' } as const;

    // Keep the window even if moderation deletes the account.
    const expiresAt = sql`statement_timestamp() + interval '24 hours'`;
    await tx.insert(signupWindows).values({ network, expiresAt })
      .onConflictDoUpdate({ target: signupWindows.network, set: { expiresAt } });
    return { status: 'created', user } as const;
  });
}

export async function checkPasswordLogin(email: string, password: string, getClientAddress: () => string) {
  const network = requestNetwork(getClientAddress);
  const emailKey = createHmac('sha256', AUTH_SECRET).update('password-login\0' + email).digest('hex');
  const { passwordFailures: failures, users } = schema;
  return db.transaction(async tx => {
    // Always acquire these locks in the same order. Concurrent guesses share the allowance.
    await tx.execute(sql`select pg_advisory_xact_lock(7802, hashtext(${network}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(7803, hashtext(${emailKey}))`);
    const recent = await tx.select({
      network: failures.network, emailKey: failures.emailKey,
      wait: sql<number>`ceil(extract(epoch from (${failures.expiresAt} - statement_timestamp())))::int`,
    }).from(failures).where(and(gt(failures.expiresAt, now),
      or(eq(failures.network, network), eq(failures.emailKey, emailKey)))).orderBy(asc(failures.expiresAt));
    const byEmail = recent.filter(f => f.emailKey === emailKey);
    const byNetwork = recent.filter(f => f.network === network);
    const retryAfter = Math.max(byEmail[byEmail.length - EMAIL_FAILURE_LIMIT]?.wait ?? 0,
      byNetwork[byNetwork.length - NETWORK_FAILURE_LIMIT]?.wait ?? 0);
    if (retryAfter) return { status: 'limited', retryAfter } as const;

    const [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    if (user?.passwordHash && await verifyPassword(user.passwordHash, password)) {
      return { status: 'authenticated', user } as const;
    }
    await tx.insert(failures).values({ network, emailKey });
    return { status: 'invalid' } as const;
  });
}

export function passwordWaitMessage(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  return `Too many sign-in attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}
