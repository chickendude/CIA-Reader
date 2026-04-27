/**
 * Admin controls for role + curator-language assignments (T-3.4).
 *
 * Kept separate from `permissions.ts` because those are read-side
 * checks; these are write-side ops reachable only by admins. Tests mock
 * the db surface so neither file touches Postgres directly in CI.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

export class UserNotFoundError extends Error {
  constructor(public readonly userId: string) {
    super(`User ${userId} not found`);
    this.name = 'UserNotFoundError';
  }
}

export class LastAdminError extends Error {
  constructor() {
    super('Cannot demote the last admin');
    this.name = 'LastAdminError';
  }
}

async function countAdmins(): Promise<number> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.role, 'admin'));
  return rows.length;
}

export async function setUserRole(userId: string, role: User['role']): Promise<User> {
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!existing) throw new UserNotFoundError(userId);
  const wasAdmin = (existing as User).role === 'admin';
  const demotingAdmin = wasAdmin && role !== 'admin';
  if (demotingAdmin) {
    const n = await countAdmins();
    if (n <= 1) throw new LastAdminError();
  }
  const [updated] = await db
    .update(schema.users)
    .set({ role, updatedAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning();
  return updated as User;
}

export async function grantCuratorLanguage(
  userId: string,
  language: LanguageCode,
  grantedBy: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!existing) throw new UserNotFoundError(userId);
  // Upsert so a repeated grant is a no-op rather than a DB error.
  await db
    .insert(schema.curatorLanguages)
    .values({ userId, language, grantedBy })
    .onConflictDoNothing({
      target: [schema.curatorLanguages.userId, schema.curatorLanguages.language],
    });
}

export async function revokeCuratorLanguage(
  userId: string,
  language: LanguageCode,
): Promise<void> {
  await db
    .delete(schema.curatorLanguages)
    .where(
      and(
        eq(schema.curatorLanguages.userId, userId),
        eq(schema.curatorLanguages.language, language),
      ),
    );
}

export async function listCuratorLanguages(userId: string): Promise<LanguageCode[]> {
  const rows = await db
    .select({ language: schema.curatorLanguages.language })
    .from(schema.curatorLanguages)
    .where(eq(schema.curatorLanguages.userId, userId));
  return rows.map((r) => r.language as LanguageCode);
}
