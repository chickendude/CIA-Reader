import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateToken, hashToken } from './tokens.js';
import type { User } from '../db/schema.js';

const REFRESH_TTL_DAYS = 60;

function ttlMs() {
  return REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export async function createRefreshToken(userId: string): Promise<string> {
  const token = generateToken();
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlMs());
  await db.insert(schema.refreshTokens).values({ id, userId, expiresAt });
  return token;
}

/**
 * Rotate a refresh token: mark the presented token as used and issue a new one.
 * If the presented token was already revoked, we revoke the entire user's
 * refresh-token family as a reuse-detection response — this is the standard
 * OAuth 2.0 refresh-token rotation mitigation.
 */
export async function rotateRefreshToken(
  presentedToken: string,
): Promise<{ user: User; newToken: string } | null> {
  const presentedId = hashToken(presentedToken);

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ rt: schema.refreshTokens, user: schema.users })
      .from(schema.refreshTokens)
      .innerJoin(schema.users, eq(schema.refreshTokens.userId, schema.users.id))
      .where(eq(schema.refreshTokens.id, presentedId))
      .limit(1);

    if (!row) return null;

    // Reuse detection: the token was already rotated. Burn the whole family.
    if (row.rt.revokedAt) {
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.refreshTokens.userId, row.rt.userId),
            isNull(schema.refreshTokens.revokedAt),
          ),
        );
      return null;
    }

    if (row.rt.expiresAt.getTime() <= Date.now()) return null;

    const newToken = generateToken();
    const newId = hashToken(newToken);
    const newExpiresAt = new Date(Date.now() + ttlMs());

    await tx.insert(schema.refreshTokens).values({
      id: newId,
      userId: row.rt.userId,
      expiresAt: newExpiresAt,
    });

    await tx
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date(), replacedBy: newId })
      .where(eq(schema.refreshTokens.id, presentedId));

    return { user: row.user, newToken };
  });
}

export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  const id = hashToken(presentedToken);
  await db
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.refreshTokens.id, id), isNull(schema.refreshTokens.revokedAt)));
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await db
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.refreshTokens.userId, userId),
        isNull(schema.refreshTokens.revokedAt),
        gt(schema.refreshTokens.expiresAt, new Date()),
      ),
    );
}
