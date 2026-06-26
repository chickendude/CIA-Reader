/**
 * GET /api/v1/me/stats?language=xx — per-language learning stats for
 * API clients (the Android stats screen).
 *
 * Returns the same known/learning/encountered lemma counts as the web
 * `/stats/:language` page plus a single language-level estimated
 * comprehension figure. Reading TIME is tracked locally on the client
 * (no server column yet), so it is deliberately absent here.
 *
 * The language is taken from the `language` query param; it falls back
 * to the `cia_lang` cookie (set by POST /me/languages) so a Bearer
 * client that has already switched language can omit the param.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  getLanguageStats,
  languageComprehensionPct,
} from '$lib/server/learning-stats.js';
import { LANG_COOKIE } from '$lib/server/language-context.js';
import {
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguage,
  type LanguageCode,
} from '@ciareader/shared-types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const raw =
    event.url.searchParams.get('language') ??
    event.cookies.get(LANG_COOKIE) ??
    '';
  if (!isSupportedLanguage(raw)) {
    throw error(
      400,
      `Unsupported language '${raw}'. Supported: ${SUPPORTED_LANGUAGE_CODES.join(', ')}`,
    );
  }
  const language = raw as LanguageCode;

  const [stats, comprehensionPct] = await Promise.all([
    getLanguageStats(user.id, language),
    languageComprehensionPct(user.id, language),
  ]);

  return json({
    language,
    knownCount: stats.knownCount,
    learningCount: stats.learningCount,
    encounteredCount: stats.encounteredCount,
    knownPhrasesCount: stats.knownPhrasesCount,
    learningPhrasesCount: stats.learningPhrasesCount,
    // null when the user has no processed tokens yet — the client
    // shows a dash rather than 0%.
    estimatedComprehensionPct: comprehensionPct,
  });
};
