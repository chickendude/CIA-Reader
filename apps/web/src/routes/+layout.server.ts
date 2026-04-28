import { eq } from 'drizzle-orm';

import { db } from '$lib/server/db/index.js';
import { userLanguages } from '$lib/server/db/schema.js';
import {
  LANG_COOKIE,
  languageOption,
  resolveCurrentLanguage,
} from '$lib/server/language-context.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { LayoutServerLoad } from './$types';

/**
 * Layout-level loader so every page gets the current user without each
 * +page.server.ts needing to re-pick it off locals. Kept to a small,
 * serializable shape — anything touching secret fields must still go
 * through requireUser on a per-route basis.
 *
 * Also resolves the active language (T-5.25): the rail's language
 * indicator + picker reads `availableLanguages` (the user's
 * `user_languages` rows) and `currentLanguage` (cookie-driven
 * choice, validated against the active list).
 */
export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  let activeCodes: LanguageCode[] = [];
  if (locals.user?.id) {
    try {
      const rows = await db
        .select({ language: userLanguages.language })
        .from(userLanguages)
        .where(eq(userLanguages.userId, locals.user.id));
      activeCodes = rows.map((r) => r.language as LanguageCode);
    } catch (err) {
      // Don't take the layout offline over a bad query — the picker
      // just renders empty in that case.
      console.error('layout: user_languages query failed:', err);
    }
  }

  const currentLanguage = resolveCurrentLanguage(
    cookies.get(LANG_COOKIE),
    activeCodes,
  );

  return {
    user: locals.user
      ? {
          id: locals.user.id,
          email: locals.user.email,
          displayName: locals.user.displayName,
          role: locals.user.role,
        }
      : null,
    currentLanguage,
    availableLanguages: activeCodes.map(languageOption),
  };
};
