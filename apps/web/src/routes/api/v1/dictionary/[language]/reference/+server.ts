/**
 * GET /api/v1/dictionary/:language/reference?word=<lemma>&sources=elhuyar_es,elhuyar_en,euskaltzaindia
 *
 * Basque reference-dictionary lookup (Elhuyar eu-es / eu-en + Euskaltzaindia) for
 * authenticated users — the same server-side scrapers the admin tool uses, minus
 * the admin gate. Results come from / are written to the shared 30-day DB cache,
 * so the proprietary upstream sites are hit at most once per word per window and
 * the content is never stored in `translations`.
 *
 * This powers the Primeran extension's inline external dictionaries.
 */
import { error, json } from '@sveltejs/kit';

import {
  BASQUE_REFERENCE_SOURCES,
  isBasqueReferenceSource,
  lookupBasqueReference,
  type BasqueReferenceSource,
} from '$lib/server/dictionary/basque-reference.js';
import { dbReferenceCache } from '$lib/server/dictionary/basque-reference-cache.js';
import { requireUser } from '$lib/server/auth/require-user.js';
import type { RequestHandler } from './$types';

const MAX_WORD_LENGTH = 80;

export const GET: RequestHandler = async (event) => {
  await requireUser(event);

  if (event.params.language !== 'eu') throw error(400, 'Reference lookup is Basque-only');

  const word = (event.url.searchParams.get('word') ?? '').trim();
  if (!word) throw error(400, 'Missing word');
  if (word.length > MAX_WORD_LENGTH) throw error(400, 'Word too long');

  const sourcesParam = event.url.searchParams.get('sources');
  const sources: BasqueReferenceSource[] = sourcesParam
    ? sourcesParam.split(',').map((s) => s.trim()).filter(isBasqueReferenceSource)
    : [...BASQUE_REFERENCE_SOURCES];
  if (sources.length === 0) throw error(400, 'No valid sources');

  const results = await lookupBasqueReference(word, sources, { cache: dbReferenceCache });
  return json({ word, results });
};
