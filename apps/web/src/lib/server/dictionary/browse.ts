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
 */
import { and, asc, count, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Lemma } from '../db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

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

/**
 * List lemmas for a language, filtered and paginated.
 *
 * Returns both the rows and a total-count so the UI can render a page
 * indicator without a second round trip.
 */
export async function listDictionaryLemmas(
  language: LanguageCode,
  query: BrowseQuery = {},
): Promise<BrowseResult> {
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  const q = normalizeQuery(query.q);

  const conditions = [eq(schema.lemmas.language, language)];
  if (q) {
    conditions.push(ilike(schema.lemmas.headword, `${escapeLikePrefix(q)}%`));
  }
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
        WHERE t.lemma_id = ${schema.lemmas.id}
          AND t.hidden = false
          AND t.source IN ('official_dictionary', 'curator')
      )`,
    );
  }
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

  return {
    lemmas: rows as Lemma[],
    totalCount: Number(n),
    limit,
    offset,
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
