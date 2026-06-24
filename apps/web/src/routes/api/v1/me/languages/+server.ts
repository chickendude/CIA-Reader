import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/require-user.js';
import {
  listUserLanguages,
  upsertUserLanguage,
  withDefaultsForAllLanguages,
} from '$lib/server/profile.js';
import { knownLemmaCountsByLanguage } from '$lib/server/learning-stats.js';
import {
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
} from '$lib/server/language-context.js';
import { LANGUAGES, isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';
import { parseJson } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const [persisted, knownCounts] = await Promise.all([
    listUserLanguages(user.id),
    // Distinct known lemmas per language, fetched once and looked up
    // per row below so the Android switcher can show "N words" without
    // a separate stats request.
    knownLemmaCountsByLanguage(user.id),
  ]);
  return json({
    languages: withDefaultsForAllLanguages(persisted).map((row) => ({
      ...row,
      displayName: LANGUAGES[row.code].displayName,
      nativeName: LANGUAGES[row.code].nativeName,
      script: LANGUAGES[row.code].script,
      supportedRomanizations: LANGUAGES[row.code].supportedRomanizations,
      knownLemmaCount: knownCounts.get(row.code) ?? 0,
    })),
  });
};

const addSchema = z.object({
  code: z.string().refine(isSupportedLanguage, { message: 'Unsupported language' }),
});

/**
 * POST /api/v1/me/languages — add a language to the user's list and make it
 * current in one step (#436, the rail switcher's "Add a language" action).
 *
 * The upsert with an empty patch creates a `user_languages` row carrying the
 * column defaults (baseline `none`, native script) when the user has never
 * read this language, and is a harmless no-op when they already have — so
 * the switcher can POST here whether the target is new or already-added.
 * Setting the cookie too means "add" and "switch" land in a single request.
 */
export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const { code } = await parseJson(event.request, addSchema);

  await upsertUserLanguage(user.id, code as LanguageCode, {});

  event.cookies.set(LANG_COOKIE, code, {
    path: '/',
    maxAge: LANG_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false,
  });

  return json({ code });
};
