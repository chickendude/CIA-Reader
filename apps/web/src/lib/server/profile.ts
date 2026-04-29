import { and, eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import type {
  User,
  UserLanguage,
} from './db/schema.js';
import { SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@ciareader/shared-types';

export type ProfileUserPatch = {
  displayName?: string | null;
  themePreference?: User['themePreference'];
};

export type UserLanguagePatch = {
  scriptPreference?: UserLanguage['scriptPreference'];
  romanizationScheme?: UserLanguage['romanizationScheme'];
  // T-5.1b reader settings — every reader-popover field writes back
  // here. None are required; absent keys leave the existing column
  // untouched so partial updates from the popover work without
  // re-stating untouched values.
  readerLayoutMode?: UserLanguage['readerLayoutMode'];
  wordsPerPage?: UserLanguage['wordsPerPage'];
  fontFamily?: UserLanguage['fontFamily'];
  fontSize?: UserLanguage['fontSize'];
  lineSpacing?: UserLanguage['lineSpacing'];
  highlightStyle?: UserLanguage['highlightStyle'];
  readingWidth?: UserLanguage['readingWidth'];
};

export async function updateUserProfile(
  userId: string,
  patch: ProfileUserPatch,
): Promise<User> {
  // At least one field must change — otherwise skip the write entirely so an
  // empty form submit doesn't bump updated_at for no reason.
  if (patch.displayName === undefined && patch.themePreference === undefined) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new Error('user not found');
    return user;
  }

  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) setClause.displayName = patch.displayName;
  if (patch.themePreference !== undefined) setClause.themePreference = patch.themePreference;

  const [updated] = await db
    .update(schema.users)
    .set(setClause)
    .where(eq(schema.users.id, userId))
    .returning();
  if (!updated) throw new Error('user not found');
  return updated;
}

export async function listUserLanguages(userId: string): Promise<UserLanguage[]> {
  return db
    .select()
    .from(schema.userLanguages)
    .where(eq(schema.userLanguages.userId, userId));
}

/**
 * Upsert a single (user, language) preferences row. If the user has never
 * engaged with this language before, a row is created with defaults; the
 * patch is then merged on top.
 */
export async function upsertUserLanguage(
  userId: string,
  languageCode: LanguageCode,
  patch: UserLanguagePatch,
): Promise<UserLanguage> {
  const existing = await db
    .select()
    .from(schema.userLanguages)
    .where(
      and(
        eq(schema.userLanguages.userId, userId),
        eq(schema.userLanguages.language, languageCode),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    type InsertValues = typeof schema.userLanguages.$inferInsert;
    const insertValues: InsertValues = {
      userId,
      language: languageCode,
      scriptPreference: patch.scriptPreference ?? 'native',
      romanizationScheme: patch.romanizationScheme ?? 'iso15919',
    };
    // Reader settings (T-5.1b) — only set when the patch explicitly
    // provided one; otherwise let the column default kick in.
    if (patch.readerLayoutMode !== undefined) insertValues.readerLayoutMode = patch.readerLayoutMode;
    if (patch.wordsPerPage !== undefined) insertValues.wordsPerPage = patch.wordsPerPage;
    if (patch.fontFamily !== undefined) insertValues.fontFamily = patch.fontFamily;
    if (patch.fontSize !== undefined) insertValues.fontSize = patch.fontSize;
    if (patch.lineSpacing !== undefined) insertValues.lineSpacing = patch.lineSpacing;
    if (patch.highlightStyle !== undefined) insertValues.highlightStyle = patch.highlightStyle;
    if (patch.readingWidth !== undefined) insertValues.readingWidth = patch.readingWidth;
    const [row] = await db
      .insert(schema.userLanguages)
      .values(insertValues)
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  const existingRow = existing[0]!;

  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.scriptPreference !== undefined) setClause.scriptPreference = patch.scriptPreference;
  if (patch.romanizationScheme !== undefined) {
    setClause.romanizationScheme = patch.romanizationScheme;
  }
  if (patch.readerLayoutMode !== undefined) setClause.readerLayoutMode = patch.readerLayoutMode;
  if (patch.wordsPerPage !== undefined) setClause.wordsPerPage = patch.wordsPerPage;
  if (patch.fontFamily !== undefined) setClause.fontFamily = patch.fontFamily;
  if (patch.fontSize !== undefined) setClause.fontSize = patch.fontSize;
  if (patch.lineSpacing !== undefined) setClause.lineSpacing = patch.lineSpacing;
  if (patch.highlightStyle !== undefined) setClause.highlightStyle = patch.highlightStyle;
  if (patch.readingWidth !== undefined) setClause.readingWidth = patch.readingWidth;
  if (Object.keys(setClause).length === 1) return existingRow; // only updatedAt — no-op

  const [updated] = await db
    .update(schema.userLanguages)
    .set(setClause)
    .where(
      and(
        eq(schema.userLanguages.userId, userId),
        eq(schema.userLanguages.language, languageCode),
      ),
    )
    .returning();
  if (!updated) throw new Error('update returned no row');
  return updated;
}

/**
 * Pure helper: merges the user's persisted per-language rows with the
 * registry's full MVP list, so the profile UI can render one entry per
 * supported language even if the user has never touched Odia yet. Keeps the
 * "you have 3 languages but 2 use defaults" case out of the SQL.
 */
export function withDefaultsForAllLanguages(
  persisted: UserLanguage[],
): Array<{
  code: LanguageCode;
  scriptPreference: UserLanguage['scriptPreference'];
  romanizationScheme: UserLanguage['romanizationScheme'];
  isDefault: boolean;
}> {
  const byCode = new Map(persisted.map((r) => [r.language as LanguageCode, r]));
  return SUPPORTED_LANGUAGE_CODES.map((code) => {
    const row = byCode.get(code);
    return row
      ? {
          code,
          scriptPreference: row.scriptPreference,
          romanizationScheme: row.romanizationScheme,
          isDefault: false,
        }
      : {
          code,
          scriptPreference: 'native' as const,
          romanizationScheme: 'iso15919' as const,
          isDefault: true,
        };
  });
}
