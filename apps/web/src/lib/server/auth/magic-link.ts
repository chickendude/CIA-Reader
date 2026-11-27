import { and, eq, isNull, gt, count, lte, sql } from 'drizzle-orm';
import { EMAIL_DAILY_LIMIT, EMAIL_UNVERIFIED_DAILY_LIMIT, EMAIL_PER_ACCOUNT_LIMIT } from '../env.js';
import { db, schema } from '../db/index.js';
import { generateToken, hashToken } from './tokens.js';
import type { User } from '../db/schema.js';

const MAGIC_LINK_TTL_MINUTES = 15;

export async function createMagicLink(userId: string, verifiedSignin: boolean): Promise<string | null> {
  return db.transaction(async tx => {
    // All web and API instances reserve a slot before SMTP, including retries.
    await tx.execute(sql`select pg_advisory_xact_lock(7462, 76)`);
    const attempts = schema.accountEmailAttempts;
    const cutoff = sql`statement_timestamp() - interval '24 hours'`;
    await tx.delete(attempts).where(lte(attempts.createdAt, cutoff));
    const [usage] = await tx.select({
      total: count(),
      unverified: sql<number>`count(*) filter (where not ${attempts.verifiedSignin})`.mapWith(Number),
      account: sql<number>`count(*) filter (where ${attempts.userId} = ${userId})`.mapWith(Number),
    }).from(attempts);
    if (!usage || usage.total >= EMAIL_DAILY_LIMIT || usage.account >= EMAIL_PER_ACCOUNT_LIMIT
      || (!verifiedSignin && usage.unverified >= EMAIL_UNVERIFIED_DAILY_LIMIT)) return null;

    const token = generateToken();
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);
    await tx.insert(attempts).values({ userId, verifiedSignin });
    await tx.insert(schema.magicLinks).values({ id: hashToken(token), userId, expiresAt });
    return token;
  });
}

/**
 * Atomically consume a magic link. Returns the associated user on success,
 * or null if the link is unknown, expired, or already used.
 */
export async function consumeMagicLink(token: string): Promise<User | null> {
  const id = hashToken(token);
  const now = new Date();

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ link: schema.magicLinks, user: schema.users })
      .from(schema.magicLinks)
      .innerJoin(schema.users, eq(schema.magicLinks.userId, schema.users.id))
      .where(
        and(
          eq(schema.magicLinks.id, id),
          isNull(schema.magicLinks.consumedAt),
          gt(schema.magicLinks.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) return null;

    await tx
      .update(schema.magicLinks)
      .set({ consumedAt: now })
      .where(eq(schema.magicLinks.id, id));

    // Magic-link consumption doubles as email verification.
    if (!row.user.emailVerifiedAt) {
      await tx
        .update(schema.users)
        .set({ emailVerifiedAt: now })
        .where(eq(schema.users.id, row.user.id));
      return { ...row.user, emailVerifiedAt: now };
    }

    return row.user;
  });
}
