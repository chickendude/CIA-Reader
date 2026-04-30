/**
 * Curator phrase editor detail page (T-14.4a).
 *
 * Loads the full editor view (phrase + tokens + every
 * translation including hidden + chapter occurrences + recent
 * audit history) and renders an inline edit form. The PATCH
 * goes through `/api/v1/admin/phrases/:id`.
 *
 * Permission: requireCanEditDictionary on the phrase's
 * language. Anonymous + non-curator visitors are bounced by
 * the `/moderation` layout guard before this loader fires.
 */
import { error } from '@sveltejs/kit';

import {
  getPhraseEditorView,
  publicPhrase,
} from '$lib/server/phrases.js';
import { publicTranslation } from '$lib/server/dictionary/translations.js';
import { LANGUAGES } from '@ciareader/shared-types';
import {
  ForbiddenError,
  requireCanEditDictionary,
} from '$lib/server/dictionary/permissions.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, parent }) => {
  const { moderator } = await parent();
  if (!UUID_RE.test(params.id)) throw error(400, 'Invalid phrase id');

  const view = await getPhraseEditorView(params.id);
  if (!view) throw error(404, 'Phrase not found');

  try {
    await requireCanEditDictionary(
      { id: moderator.id, role: moderator.role },
      view.phrase.language as LanguageCode,
    );
  } catch (err) {
    if (err instanceof ForbiddenError) throw error(403, err.message);
    throw err;
  }

  return {
    phrase: {
      ...publicPhrase(view.phrase, view.tokens),
      hidden: view.phrase.hidden,
    },
    translations: view.translations.map(publicTranslation),
    chapterIds: view.chapterIds,
    history: view.history,
    languageDescriptor: {
      code: view.phrase.language as LanguageCode,
      displayName: LANGUAGES[view.phrase.language as LanguageCode].displayName,
      nativeName: LANGUAGES[view.phrase.language as LanguageCode].nativeName,
    },
  };
};
