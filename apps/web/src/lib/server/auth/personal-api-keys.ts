import { and, desc, eq, isNull } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { PersonalApiKey, User } from '../db/schema.js';
import { generateToken, hashToken } from './tokens.js';

export const PERSONAL_API_KEY_PREFIX = 'ciar_pk_';
const TOKEN_BYTES = 32;

export type PublicPersonalApiKey = Pick<
  PersonalApiKey,
  'id' | 'name' | 'keyPrefix' | 'lastUsedAt' | 'revokedAt' | 'createdAt'
>;

export type CreatedPersonalApiKey = {
  key: string;
  record: PublicPersonalApiKey;
};

function publicKey(row: PersonalApiKey): PublicPersonalApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export function normalizePersonalApiKey(value: string): string | null {
  const key = value.trim();
  return key.startsWith(PERSONAL_API_KEY_PREFIX) ? key : null;
}

export function generatePersonalApiKeySecret(): string {
  return `${PERSONAL_API_KEY_PREFIX}${generateToken(TOKEN_BYTES)}`;
}

export async function createPersonalApiKey(
  userId: string,
  name: string,
): Promise<CreatedPersonalApiKey> {
  const key = generatePersonalApiKeySecret();
  const [record] = await db
    .insert(schema.personalApiKeys)
    .values({
      userId,
      name,
      keyHash: hashToken(key),
      keyPrefix: key.slice(0, 18),
    })
    .returning();
  if (!record) throw new Error('Failed to create personal API key');
  return { key, record: publicKey(record) };
}

export async function listPersonalApiKeys(
  userId: string,
): Promise<PublicPersonalApiKey[]> {
  const rows = await db
    .select()
    .from(schema.personalApiKeys)
    .where(eq(schema.personalApiKeys.userId, userId))
    .orderBy(desc(schema.personalApiKeys.createdAt));
  return rows.map(publicKey);
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
