/**
 * GET /api/v1/phrases/:id (T-14.1).
 *
 * Detail view: phrase + ordered phrase_tokens + visible (non-hidden)
 * translations targeting the phrase. Returns 404 if the phrase id
 * doesn't exist. Anonymous-readable like the dictionary browse
 * detail (T-3.6).
 */
import { error, json } from '@sveltejs/kit';

import { getPhrase, publicPhrase } from '$lib/server/phrases.js';
import { publicTranslation } from '$lib/server/dictionary/translations.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async (event) => {
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) {
    throw error(400, 'Invalid phrase id');
  }
  const result = await getPhrase(id);
  if (!result) throw error(404, 'Phrase not found');
  return json({
    phrase: publicPhrase(result.phrase, result.tokens),
    translations: result.translations.map(publicTranslation),
  });
};
