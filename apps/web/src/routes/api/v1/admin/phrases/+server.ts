/**
 * GET /api/v1/admin/phrases (T-14.4a).
 *
 * Curator dictionary editor list view. Returns paginated phrase
 * rows with translation + chapter counts so the curator can scan
 * the dictionary at a glance and pick a row to edit.
 *
 * Permission: curator or admin with a curator-language grant for
 * the requested language. Same model as /admin/lemmas.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { listAdminPhrases } from '$lib/server/phrases.js';
import {
  ForbiddenError,
  requireCanEditDictionary,
} from '$lib/server/dictionary/permissions.js';
import { SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@ciareader/shared-types';
import type { RequestHandler } from './$types';

const LANGS = SUPPORTED_LANGUAGE_CODES as readonly [LanguageCode, ...LanguageCode[]];
// T-14.4a: source filter values match the `translation_source`
// enum on this branch. T-14.5a adds `'nlp'`; once it merges
// (and the migration lands), this list extends in lockstep.
const SOURCES = ['user', 'curator', 'official_dictionary'] as const;

const query = z.object({
  language: z.enum(LANGS),
  source: z.enum(SOURCES).optional(),
  locked: z.enum(['true', 'false']).optional(),
  hidden: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const params = query.safeParse(
    Object.fromEntries(event.url.searchParams.entries()),
  );
  if (!params.success) throw error(400, 'Invalid query parameters');

  try {
    await requireCanEditDictionary(user, params.data.language as LanguageCode);
    const rows = await listAdminPhrases({
      language: params.data.language,
      source: params.data.source,
      locked:
        params.data.locked === undefined
          ? undefined
          : params.data.locked === 'true',
      hidden:
        params.data.hidden === undefined
          ? undefined
          : params.data.hidden === 'true',
      limit: params.data.limit,
      offset: params.data.offset,
    });
    return json({
      phrases: rows,
      page: { limit: params.data.limit, offset: params.data.offset },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) throw error(403, err.message);
    throw err;
  }
};
