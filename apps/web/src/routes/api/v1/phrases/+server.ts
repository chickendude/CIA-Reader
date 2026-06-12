/**
 * POST /api/v1/phrases  — create or reuse a phrase (T-14.1).
 * GET  /api/v1/phrases  — list phrases for a language.
 *
 * Phrase creation dedupes against `(language, surface_normalised,
 * source)` so a second user submitting the same surface reuses the
 * existing row. The endpoint returns 201 for a fresh insert and 200
 * for a dedupe hit so clients can distinguish the two without re-
 * fetching.
 *
 * The `source` of the row is locked to `user` for non-curator
 * callers — admins and curators may submit `curator` /
 * `official_dictionary` rows via this surface; the dictionary
 * editor in T-14.4 layers a richer admin-only path on top.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { parseJson } from '../auth/_helpers.js';
import {
  createPhrase,
  listPhrasesForLanguage,
  publicPhrase,
  PhraseValidationError,
  MAX_PHRASE_TOKENS,
} from '$lib/server/phrases.js';
import type { RequestHandler } from './$types';
import { SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@ciareader/shared-types';

const LANGS = SUPPORTED_LANGUAGE_CODES as readonly [LanguageCode, ...LanguageCode[]];
const SOURCES = ['user', 'curator', 'official_dictionary'] as const;

const createBody = z.object({
  language: z.enum(LANGS),
  // Each token is a single surface form. Server enforces the
  // detailed bounds (MIN/MAX_PHRASE_TOKENS, punctuation guard);
  // Zod just rejects obvious garbage early.
  tokens: z.array(z.string()).min(1).max(MAX_PHRASE_TOKENS + 4),
  pos: z.string().max(32).nullish(),
  glossDefault: z.string().max(500).nullish(),
  source: z.enum(SOURCES).default('user'),
  sourceAttribution: z.string().max(200).nullish(),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const input = await parseJson(event.request, createBody);

  // Source policy: regular users are locked to source='user'.
  // Curator / admin may set any allowed source. The role check
  // mirrors the existing dictionary editor (T-3.4).
  const sourceAllowed =
    input.source === 'user' ||
    user.role === 'curator' ||
    user.role === 'admin';
  if (!sourceAllowed) {
    throw error(
      403,
      'Only curators or admins may submit phrases under that source',
    );
  }

  try {
    const result = await createPhrase({
      language: input.language,
      tokens: input.tokens,
      pos: input.pos ?? null,
      glossDefault: input.glossDefault ?? null,
      // The zod schema defaults `source` to 'user' when omitted,
      // but the inferred type carries `undefined` until parse —
      // the fallback here is belt-and-braces.
      source: input.source ?? 'user',
      submittedBy: user.id,
      sourceAttribution: input.sourceAttribution ?? null,
      bypassTokenCap: user.role === 'curator' || user.role === 'admin',
    });
    return json(
      { phrase: publicPhrase(result.phrase, result.tokens), reused: result.reused },
      { status: result.reused ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof PhraseValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};

const listQuery = z.object({
  language: z.enum(LANGS),
  source: z.enum(SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET: RequestHandler = async (event) => {
  // Listing is anonymous-readable — same posture as the dictionary
  // browse page (T-3.6). The endpoint returns the phrase header
  // only; translations are hydrated by `GET /api/v1/phrases/:id`
  // to keep this list cheap.
  const params = listQuery.safeParse(
    Object.fromEntries(event.url.searchParams.entries()),
  );
  if (!params.success) {
    throw error(400, 'Invalid query parameters');
  }
  const rows = await listPhrasesForLanguage({
    language: params.data.language,
    source: params.data.source,
    limit: params.data.limit,
    offset: params.data.offset,
  });
  // No tokens hydrated here — the list view shows
  // `surface_normalised` only. Detail view does the join.
  return json({
    phrases: rows.map((p) =>
      publicPhrase(p, []).tokens.length === 0
        ? {
            id: p.id,
            language: p.language,
            surfaceNormalised: p.surfaceNormalised,
            pos: p.pos,
            glossDefault: p.glossDefault,
            frequencyRank: p.frequencyRank,
            source: p.source,
            sourceAttribution: p.sourceAttribution,
            curatorLocked: p.curatorLocked,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          }
        : publicPhrase(p, []),
    ),
  });
};
