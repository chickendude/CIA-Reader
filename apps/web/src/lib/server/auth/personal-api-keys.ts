import { and, eq, isNull } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { generateToken, hashToken } from './tokens.js';

export const PERSONAL_API_KEY_PREFIX = 'ciar_pk_';
const TOKEN_BYTES = 32;

export function normalizePersonalApiKey(value: string): string | null {
  const key = value.trim();
  return key.startsWith(PERSONAL_API_KEY_PREFIX) ? key : null;
}

export function generatePersonalApiKeySecret(): string {
  return `${PERSONAL_API_KEY_PREFIX}${generateToken(TOKEN_BYTES)}`;
}

export async function createPersonalApiKey(userId: string): Promise<string | null> {
  const t = schema.personalApiKeys;
  const key = generatePersonalApiKeySecret();
  const [created] = await db
    .insert(t)
    .values({ userId, keyHash: hashToken(key), keyPrefix: key.slice(0, 18) })
    .onConflictDoNothing({ target: t.userId, where: isNull(t.revokedAt) })
    .returning({ id: t.id });
  return created ? key : null;
}

export async function getActivePersonalApiKey(userId: string) {
  const t = schema.personalApiKeys;
  const [key] = await db.select({ id: t.id, keyPrefix: t.keyPrefix, lastUsedAt: t.lastUsedAt })
    .from(t)
    .where(and(eq(t.userId, userId), isNull(t.revokedAt)))
    .limit(1);
  return key ?? null;
}

export async function revokePersonalApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const rows = await db
    .update(schema.personalApiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.personalApiKeys.id, keyId),
        eq(schema.personalApiKeys.userId, userId),
        isNull(schema.personalApiKeys.revokedAt),
      ),
    )
    .returning({ id: schema.personalApiKeys.id });
  return rows.length > 0;
}

export async function resolvePersonalApiKey(value: string): Promise<User | null> {
  const key = normalizePersonalApiKey(value);
  if (!key) return null;
  const keyHash = hashToken(key);

  const [row] = await db
    .select({ apiKey: schema.personalApiKeys, user: schema.users })
    .from(schema.personalApiKeys)
    .innerJoin(schema.users, eq(schema.personalApiKeys.userId, schema.users.id))
    .where(and(eq(schema.personalApiKeys.keyHash, keyHash), isNull(schema.personalApiKeys.revokedAt)))
    .limit(1);

  if (!row) return null;

  await db
    .update(schema.personalApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(schema.personalApiKeys.id, row.apiKey.id),
        isNull(schema.personalApiKeys.revokedAt),
      ),
    );

  return row.user;
}
