/**
 * Words manager loader (T-10.6).
 *
 * Lists the caller's vocabulary — every lemma they've touched —
 * filtered by an optional language code, an optional status bucket,
 * and an optional free-text query. Joined against `lemmas` so we
 * read headword + POS + gloss in a single query.
 *
 * Auth required. Anonymous visitors are bounced to /login with a
 * `next` param so they return here after signing in.
 */
import { and, desc, eq, ilike, or as orWhere, type SQL } from 'drizzle-orm';
import { error, redirect } from '@sveltejs/kit';

import { db } from '$lib/server/db/index.js';
import { lemmas, userKnownLemmas } from '$lib/server/db/schema.js';
import {
  isSupportedLanguage,
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  type LanguageCode,
} from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

export type WordsStatus = 'all' | 'unknown' | 'learning' | 'known' | 'ignored';

const VALID_STATUSES: readonly WordsStatus[] = [
  'all',
  'unknown',
  'learning',
  'known',
  'ignored',
];

const ROW_LIMIT = 200;

export type WordRow = {
  lemmaId: string;
  language: LanguageCode;
  headword: string;
  pos: string;
  glossDefault: string | null;
  status: 'unknown' | 'learning' | 'known' | 'ignored';
  updatedAt: Date;
};

function readLanguage(raw: string | null): LanguageCode | null {
  if (!raw) return null;
  if (!isSupportedLanguage(raw)) {
    throw error(400, `Unsupported language '${raw}'`);
  }
  return raw as LanguageCode;
}

function readStatus(raw: string | null): WordsStatus {
  if (!raw) return 'all';
  if (!VALID_STATUSES.includes(raw as WordsStatus)) {
    throw error(400, `Unknown status '${raw}'`);
  }
  return raw as WordsStatus;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  if (!locals.user) {
    throw redirect(
      303,
      `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
    );
  }

  const language = readLanguage(url.searchParams.get('language'));
  const status = readStatus(url.searchParams.get('status'));
  const q = (url.searchParams.get('q') ?? '').trim();

  const conditions: SQL[] = [eq(userKnownLemmas.userId, locals.user.id)];
  if (language) conditions.push(eq(lemmas.language, language));
  if (status !== 'all') conditions.push(eq(userKnownLemmas.status, status));
  if (q.length > 0) {
    const pattern = `%${q}%`;
    const search = orWhere(
      ilike(lemmas.headword, pattern),
      ilike(lemmas.glossDefault, pattern),
    );
    if (search) conditions.push(search);
  }

  const rawRows = await db
    .select({
      lemmaId: userKnownLemmas.lemmaId,
      language: lemmas.language,
      headword: lemmas.headword,
      pos: lemmas.pos,
      glossDefault: lemmas.glossDefault,
      status: userKnownLemmas.status,
      updatedAt: userKnownLemmas.updatedAt,
    })
    .from(userKnownLemmas)
    .innerJoin(lemmas, eq(lemmas.id, userKnownLemmas.lemmaId))
    .where(and(...conditions))
    .orderBy(desc(userKnownLemmas.updatedAt))
    .limit(ROW_LIMIT);

  const rows: WordRow[] = rawRows.map((r) => ({
    lemmaId: r.lemmaId,
    language: r.language as LanguageCode,
    headword: r.headword,
    pos: r.pos,
    glossDefault: r.glossDefault,
    status: r.status,
    updatedAt: r.updatedAt,
  }));

  return {
    rows,
    truncated: rawRows.length === ROW_LIMIT,
    filters: {
      language,
      status,
      q,
    },
    languages: SUPPORTED_LANGUAGE_CODES.map((code) => ({
      code,
      displayName: LANGUAGES[code].displayName,
      nativeName: LANGUAGES[code].nativeName,
    })),
  };
};
