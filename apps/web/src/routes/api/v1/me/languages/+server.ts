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

/** Add the language to the reader's account and select it in the same request. */
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
