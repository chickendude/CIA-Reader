/**
 * GET /api/v1/admin/basque-dictionary?word=<lemma>&sources=elhuyar_es,elhuyar_en,euskaltzaindia
 *
 * Admin-only Basque dictionary *reference* lookup (Elhuyar + Euskaltzaindia).
 * These are proprietary sources we never store or redistribute — this endpoint
 * fetches + parses them on demand purely as a translation-verification aid for
 * admins. Non-admins get 403. See `$lib/server/dictionary/basque-reference.ts`.
 */
import { error, json } from '@sveltejs/kit';

import {
  BASQUE_REFERENCE_SOURCES,
  isBasqueReferenceSource,
  lookupBasqueReference,
  type BasqueReferenceSource,
} from '$lib/server/dictionary/basque-reference.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import type { RequestHandler } from './$types';

const MAX_WORD_LENGTH = 80;

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!isAdmin({ role: locals.user.role })) throw error(403, 'Admin role required');

  const word = (url.searchParams.get('word') ?? '').trim();
  if (!word) throw error(400, 'Missing word');
  if (word.length > MAX_WORD_LENGTH) throw error(400, 'Word too long');

  const sourcesParam = url.searchParams.get('sources');
  let sources: BasqueReferenceSource[];
  if (sourcesParam) {
    sources = sourcesParam
      .split(',')
      .map((s) => s.trim())
      .filter(isBasqueReferenceSource);
    if (sources.length === 0) throw error(400, 'No valid sources');
  } else {
    sources = [...BASQUE_REFERENCE_SOURCES];
  }

  const results = await lookupBasqueReference(word, sources);
  return json({ word, results });
};
