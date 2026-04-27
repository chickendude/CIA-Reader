import { and, eq, isNull, gt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateToken, hashToken } from './tokens.js';
import type { User } from '../db/schema.js';

const MAGIC_LINK_TTL_MINUTES = 15;

export async function createMagicLink(userId: string): Promise<string> {
  const token = generateToken();
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);
  await db.insert(schema.magicLinks).values({ id, userId, expiresAt });
  return token;
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
