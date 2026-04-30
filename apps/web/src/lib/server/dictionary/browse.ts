/**
 * Public lemma-browsing service (T-3.6).
 *
 * The backing page is `/dictionary/:language` — public, unauthenticated-
 * accessible, rendered server-side so it ranks for "<lemma> meaning"
 * searches. This service is also the backing for the JSON endpoint used
 * by the dictionary editor (T-3.7) and the correction modal (T-6.2), so
 * it stays free of HTML concerns.
 *
 * Search is a simple case-insensitive prefix match on the NFC-normalized
 * headword. The client-side `<ScriptAwareInput>` (T-6.2a) is responsible
 * for turning a user's romanized input into the native script before it
 * arrives here — this service does not transliterate.
 *
 * Nukta-agnostic fallback (#318): when the user's query has zero
 * exact-prefix hits AND the query strips down to something different
 * (i.e. it itself contained a nukta marker, OR an entry in the table
 * has nuktas the query lacks), we re-run the search against the
 * `headword_nukta_stripped` generated column with the query also
 * nukta-stripped. This is **lossy by design** (`ज़रा` and `जरा` collapse
 * to the same key), so the result advertises `usedNuktaFallback` and
 * the UI surfaces a "showing nukta-agnostic results" hint.
 */
import { and, asc, count, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Lemma } from '../db/schema.js';
import { stripNukta, type LanguageCode } from '@ciareader/shared-types';

/**
 * Default + cap. Browse pages are paginated; the cap keeps a rogue
 * client from asking for the entire language at once (~100k+ rows at
 * maturity).
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type BrowseQuery = {
  q?: string | null;
  pos?: readonly string[] | null;
  /** Inclusive lower bound on frequency rank (1 = most frequent). */
  minRank?: number | null;
  /** Inclusive upper bound on frequency rank. */
  maxRank?: number | null;
  /** If true, only return lemmas that already have at least one non-
   * hidden translation from `official_dictionary` or `curator`. */
  hasOfficialTranslation?: boolean | null;
  limit?: number | null;
  offset?: number | null;
};

export type BrowseResult = {
  lemmas: Lemma[];
  totalCount: number;
  limit: number;
  offset: number;
  /**
   * #318: True when these results came from the nukta-agnostic
   * fallback tier — i.e. the strict ILIKE on `headword` returned zero
   * hits AND we re-queried against `headword_nukta_stripped`. The UI
   * uses this to render a "showing nukta-agnostic results" hint so
   * the lossy step is visible to the user. False whenever the result
   * came from the strict tier (including when both tiers would have
   * been empty — there's no fallback to advertise).
   */
  usedNuktaFallback: boolean;
};

/** `%` and `_` are the two wildcards Postgres recognises in LIKE/ILIKE. */
function escapeLikePrefix(input: string): string {
  return input.replace(/([\\%_])/g, '\\$1');
}

function clampLimit(raw: number | null | undefined): number {
  if (!raw || raw <= 0) return DEFAULT_PAGE_SIZE;
  if (raw > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return Math.floor(raw);
}

function clampOffset(raw: number | null | undefined): number {
  if (!raw || raw <= 0) return 0;
  return Math.floor(raw);
}

function normalizeQuery(q: string | null | undefined): string | null {
  if (!q) return null;
  const trimmed = q.normalize('NFC').trim();
  return trimmed.length > 0 ? trimmed : null;
}

type SearchClause = ReturnType<typeof ilike> | null;

/**
 * Build the non-search filter conditions (language, POS, rank range,
 * has-official). Shared between the strict tier and the
 * nukta-agnostic fallback so the two tiers can't drift on what
 * "matches the rest of the query" means.
 */
function baseConditions(language: LanguageCode, query: BrowseQuery) {
  const conditions = [eq(schema.lemmas.language, language)];
  if (query.pos && query.pos.length > 0) {
    conditions.push(inArray(schema.lemmas.pos, [...query.pos]));
  }
  if (typeof query.minRank === 'number') {
    conditions.push(gte(schema.lemmas.frequencyRank, query.minRank));
  }
  if (typeof query.maxRank === 'number') {
    conditions.push(lte(schema.lemmas.frequencyRank, query.maxRank));
  }
  if (query.hasOfficialTranslation) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${schema.translations} t
        WHERE t.target_type = 'lemma'
          AND t.target_id = ${schema.lemmas.id}
          AND t.hidden = false
          AND t.source IN ('official_dictionary', 'curator')
      )`,
    );
  }
  return conditions;
}

async function runSearchTier(
  language: LanguageCode,
  query: BrowseQuery,
  searchClause: SearchClause,
  limit: number,
  offset: number,
): Promise<{ rows: Lemma[]; totalCount: number }> {
  const conditions = baseConditions(language, query);
  if (searchClause) conditions.push(searchClause);
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select()
    .from(schema.lemmas)
    .where(where)
    .orderBy(
      // Most-frequent first. NULL ranks fall to the end; Postgres default
      // NULLS LAST for ASC is what we want, but we spell it to avoid
      // surprise if the collation ever changes.
      sql`${schema.lemmas.frequencyRank} ASC NULLS LAST`,
      asc(schema.lemmas.headword),
    )
    .limit(limit)
    .offset(offset);

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.lemmas)
    .where(where);

  return { rows: rows as Lemma[], totalCount: Number(n) };
}

/**
 * List lemmas for a language, filtered and paginated.
 *
 * Returns both the rows and a total-count so the UI can render a page
 * indicator without a second round trip.
 *
 * Search tiers (#318):
 *  1. Strict: case-insensitive ILIKE prefix on `headword` (NFC).
 *  2. Nukta-agnostic fallback: ILIKE prefix on
 *     `headword_nukta_stripped` with the query also stripped. Fires
 *     whenever the strict tier returned zero rows for a non-empty
 *     query. The fallback handles BOTH directions of the user/DB
 *     mismatch — user typed `पढना` and DB has `पढ़ना`, OR user typed
 *     `पढ़ना` and DB has `पढना` — because both sides reduce to the
 *     same nukta-free key.
 *
 * Cost shape: the second tier costs at most one extra index seek
 * when the strict tier missed AND the query was non-empty. On the
 * happy path (strict hit) we issue exactly the same two queries as
 * before.
 */
export async function listDictionaryLemmas(
  language: LanguageCode,
  query: BrowseQuery = {},
): Promise<BrowseResult> {
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  const q = normalizeQuery(query.q);

  const strictClause: SearchClause = q
    ? ilike(schema.lemmas.headword, `${escapeLikePrefix(q)}%`)
    : null;
  const strict = await runSearchTier(language, query, strictClause, limit, offset);

  if (!q || strict.rows.length > 0) {
    return {
      lemmas: strict.rows,
      totalCount: strict.totalCount,
      limit,
      offset,
      usedNuktaFallback: false,
    };
  }

  // Strict tier was empty for a non-empty query — try the
  // nukta-agnostic tier. We `stripNukta` on the query side too: even
  // when the query has no nukta of its own, the stripped column on
  // the DB side has had nuktas removed, and a nukta-free query
  // matches a stored stripped value directly. When the query DID
  // have nuktas, stripping equalizes both sides.
  const stripped = stripNukta(q);
  const fallbackClause: SearchClause = ilike(
    schema.lemmas.headwordNuktaStripped,
    `${escapeLikePrefix(stripped)}%`,
  );
  const fallback = await runSearchTier(
    language,
    query,
    fallbackClause,
    limit,
    offset,
  );

  // If the fallback also misses, advertise the strict (empty) result
  // — no point telling the user we ran a fallback that found
  // nothing.
  if (fallback.rows.length === 0) {
    return {
      lemmas: strict.rows,
      totalCount: strict.totalCount,
      limit,
      offset,
      usedNuktaFallback: false,
    };
  }

  return {
    lemmas: fallback.rows,
    totalCount: fallback.totalCount,
    limit,
    offset,
    usedNuktaFallback: true,
  };
}

/**
 * Public shape for the JSON endpoint / SSR loader. We drop the columns
 * that only matter to internal tooling (`source_id`) and rename
 * `source` to `provenanceSource` to match the reader pop-up badge vocab.
 */
export function publicLemma(row: Lemma) {
  return {
    id: row.id,
    language: row.language,
    headword: row.headword,
    pos: row.pos,
    script: row.script,
    glossDefault: row.glossDefault,
    frequencyRank: row.frequencyRank,
    provenanceSource: row.source,
    sourceAttribution: row.sourceAttribution,
    curatorLocked: row.curatorLocked,
  };
}
