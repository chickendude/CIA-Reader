/**
 * Curator / admin permission checks (T-3.4).
 *
 * Every dictionary-editing code path routes through one of these helpers
 * so the logic "who can edit this row?" exists exactly once and can be
 * tightened (e.g. adding a language-scoped admin role later) without
 * chasing callsites.
 *
 * Rules:
 *  - `admin` — can edit the dictionary in every language, regardless of
 *    `curator_languages`.
 *  - `curator` — can edit the dictionary in a language iff
 *    `curator_languages` has a matching row. No row = no edit rights for
 *    that language, even for a curator (the default is opt-in).
 *  - `user` — cannot edit the dictionary.
 *
 * Community moderation (hiding community translations, reviewing parse
 * reports) is curator-or-admin regardless of language grant, because
 * those flows are not intrinsically tied to a single language.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function isAdmin(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'admin';
}

export function isCuratorOrAdmin(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'curator' || user?.role === 'admin';
}

/**
 * Does the viewer have edit rights on dictionary content for `language`?
 * Admins always pass; curators need a `curator_languages` grant.
 */
export async function canEditDictionary(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  language: LanguageCode,
): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (user.role !== 'curator') return false;
  const [row] = await db
    .select({ language: schema.curatorLanguages.language })
    .from(schema.curatorLanguages)
    .where(
      and(
        eq(schema.curatorLanguages.userId, user.id),
        eq(schema.curatorLanguages.language, language),
      ),
    )
    .limit(1);
  return !!row;
}

export async function requireCanEditDictionary(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  language: LanguageCode,
): Promise<void> {
  const ok = await canEditDictionary(user, language);
  if (!ok) throw new ForbiddenError('You do not have curator rights for this language');
}

export function requireAdmin(
  user: Pick<User, 'role'> | null | undefined,
): asserts user is Pick<User, 'role'> {
  if (!isAdmin(user)) throw new ForbiddenError('Admin role required');
}

/**
 * Fetch the languages a curator is currently granted on. Admins pass
 * through — they get every MVP language. Used by the dictionary editor's
 * "which languages can I edit?" affordance.
 */
export async function listGrantedLanguages(
  user: Pick<User, 'id' | 'role'>,
): Promise<LanguageCode[]> {
  if (isAdmin(user)) return ['hi', 'mr', 'or'];
  if (user.role !== 'curator') return [];
  const rows = await db
    .select({ language: schema.curatorLanguages.language })
    .from(schema.curatorLanguages)
    .where(eq(schema.curatorLanguages.userId, user.id));
  return rows.map((r) => r.language as LanguageCode);
}
