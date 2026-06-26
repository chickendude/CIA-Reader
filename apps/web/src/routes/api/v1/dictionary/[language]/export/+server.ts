/**
 * GET /api/v1/dictionary/:language/export
 *
 * Full dictionary snapshot (lemmas + public translations) for offline /
 * local-first clients. The Primeran extension fetches this once and caches it in
 * IndexedDB so word look-ups are local. Authenticated; logic lives in the tested
 * `buildDictionaryExport` helper.
 */
import { error, json } from '@sveltejs/kit';

import { isSupportedLanguage } from '@ciareader/shared-types';

import { requireUser } from '$lib/server/auth/require-user.js';
import { buildDictionaryExport } from '$lib/server/dictionary/export.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  await requireUser(event);

  const language = event.params.language;
  if (!isSupportedLanguage(language)) throw error(400, 'Unsupported language');

  return json(await buildDictionaryExport(language));
};
