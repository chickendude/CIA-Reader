/**
 * User ↔ language membership (#436).
 *
 * "Adding a language" creates a `user_languages` row carrying the chosen
 * proficiency baseline. Distinct from `upsertUserLanguage` in profile.ts,
 * which patches reading preferences and deliberately never touches the
 * baseline. This one is for the dedicated "Add a language" page, where the
 * baseline is an explicit choice.
 */
import { db, schema } from './db/index.js';
import type { LanguageBaseline } from './onboarding.js';
import type { LanguageCode } from '@ciareader/shared-types';

/**
 * Add `code` to the user's languages with the given baseline. Atomic
 * upsert: a brand-new language inserts with the column defaults plus the
 * baseline; the conflict branch (a race, or re-adding) re-applies the
 * chosen baseline. Callers that must preserve an existing baseline should
 * guard on the active list before calling.
 */
export async function addUserLanguage(
  userId: string,
  code: LanguageCode,
  baseline: LanguageBaseline = 'none',
): Promise<void> {
  await db
    .insert(schema.userLanguages)
    .values({ userId, language: code, baseline })
    .onConflictDoUpdate({
      target: [schema.userLanguages.userId, schema.userLanguages.language],
      set: { baseline, updatedAt: new Date() },
    });
}
