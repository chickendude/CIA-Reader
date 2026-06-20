/**
 * Read-side dictionary queries (T-3.3).
 *
 * Keeps the service layer between the HTTP surface and Drizzle narrow
 * and typed. The translation-retrieval endpoint's ordering contract
 * lives here so it's unit-testable in isolation.
 *
 * Ordering (per T-3.3 + T-3.8):
 *
 *   1. `personal`   — translations the viewer themselves authored. Empty
 *                     for anonymous callers. `parentTranslationId`
 *                     customization forks land here too (T-3.5).
 *   2. `official`   — rows with `source IN ('official_dictionary',
 *                     'curator')`. Curator-edited rows sort ahead of
 *                     raw imports because a curator has explicitly
 *                     signed off on them. Hidden officials are
 *                     suppressed even though the moderation flow
 *                     doesn't write `hidden=true` on officials today.
 *   3. `community`  — other users' `source='user'` submissions.
 *                     Ordered newest-first at MVP; T-10.4 will swap in
 *                     a vote-weighted sort once `translation_votes`
 *                     lands. Hidden rows excluded for anonymous + non-
 *                     curator viewers.
 */
import { and, eq, ne, sql } from 'drizzle-orm';

import { stripNukta } from '@ciareader/shared-types';

import { db, schema } from '../db/index.js';
import type { Lemma, Translation, User } from '../db/schema.js';
import type { TranslationVoteValue } from './votes.js';

/**
 * Viewer-relative provenance category (T-3.8). The reader pop-up renders
 * one badge per translation — the badge reads off `provenance.kind`,
 * NOT off `source`, because "personal" requires knowing who the viewer
 * is (a user's own `source='user'` row shows a different badge than the
 * same row displayed to a different viewer).
 *
 *  - `personal`   — the viewer themselves authored this row (or forked
 *                   an official via T-3.5). Badge: "yours".
 *  - `curator`    — `source='curator'`. A curator has explicitly signed
 *                   off on this row. Badge: "curator".
 *  - `imported`   — `source='official_dictionary'`. Carries the upstream
 *                   attribution (e.g. "Hindi WordNet"). Badge: the
 *                   attribution text.
 *  - `community`  — anyone else's `source='user'` submission. Badge:
 *                   "community".
 */
export type TranslationProvenance =
  | { kind: 'personal'; attribution: null }
  | { kind: 'curator'; attribution: string | null }
  | { kind: 'imported'; attribution: string | null }
  | { kind: 'community'; attribution: null };

export type PublicTranslation = {
  id: string;
  source: Translation['source'];
  submittedBy: string | null;
  parentTranslationId: string | null;
  body: string;
  targetLanguage: string;
  sourceAttribution: string | null;
  provenance: TranslationProvenance;
  hidden: boolean;
  voteScore: number;
  viewerVote: TranslationVoteValue | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LemmaTranslationBuckets = {
  lemma: PublicLemma;
  translations: {
    personal: PublicTranslation[];
    official: PublicTranslation[];
    community: PublicTranslation[];
  };
  /**
   * Distinct definition languages (`translations.targetLanguage`) present
   * across the visible buckets, sorted. Drives the reader popup's
   * per-definition-language filter chips: a Basque lemma may carry English
   * + Spanish + monolingual-Basque glosses, and the reader can toggle each.
   * Empty when the lemma has no visible translations.
   */
  definitionLanguages: string[];
};

export type PublicLemma = {
  id: string;
  language: Lemma['language'];
  headword: string;
  pos: string;
  script: string;
  glossDefault: string | null;
  frequencyRank: number | null;
};

function toPublicLemma(row: Lemma): PublicLemma {
  return {
    id: row.id,
    language: row.language,
    headword: row.headword,
    pos: row.pos,
    script: row.script,
    glossDefault: row.glossDefault,
    frequencyRank: row.frequencyRank,
  };
}

export function deriveProvenance(
  row: Translation,
  viewer: { id: string } | null,
): TranslationProvenance {
  if (viewer && row.source === 'user' && row.submittedBy === viewer.id) {
    return { kind: 'personal', attribution: null };
  }
  if (row.source === 'curator') {
    return { kind: 'curator', attribution: row.sourceAttribution };
  }
  if (row.source === 'official_dictionary') {
    return { kind: 'imported', attribution: row.sourceAttribution };
  }
  return { kind: 'community', attribution: null };
}

function toPublicTranslation(
  row: TranslationWithVotes,
  viewer: { id: string } | null,
): PublicTranslation {
  return {
    id: row.id,
    source: row.source,
    submittedBy: row.submittedBy,
    parentTranslationId: row.parentTranslationId,
    body: row.body,
    targetLanguage: row.targetLanguage,
    sourceAttribution: row.sourceAttribution,
    provenance: deriveProvenance(row, viewer),
    hidden: row.hidden,
    voteScore: row.voteScore ?? 0,
    viewerVote: row.viewerVote ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type TranslationWithVotes = Translation & {
  voteScore?: number;
  viewerVote?: TranslationVoteValue | null;
};

/**
 * Bucket + sort translations for a single lemma under the rules
 * described at the top of this file. Exposed separately so the sorter
 * has unit tests that don't need to wire the DB mock.
 */
export function bucketTranslations(
  rows: TranslationWithVotes[],
  viewer: { id: string; role: User['role'] } | null,
): LemmaTranslationBuckets['translations'] {
  const canSeeHidden = viewer?.role === 'curator' || viewer?.role === 'admin';
  const visible = rows.filter((r) => !r.hidden || canSeeHidden);

  const personal: TranslationWithVotes[] = [];
  const official: TranslationWithVotes[] = [];
  const community: TranslationWithVotes[] = [];

  for (const row of visible) {
    if (viewer && row.source === 'user' && row.submittedBy === viewer.id) {
      personal.push(row);
    } else if (row.source === 'official_dictionary' || row.source === 'curator') {
      official.push(row);
    } else {
      community.push(row);
    }
  }

  const byCreatedAtAsc = (a: TranslationWithVotes, b: TranslationWithVotes) =>
    a.createdAt.getTime() - b.createdAt.getTime();
  const byCreatedAtDesc = (a: TranslationWithVotes, b: TranslationWithVotes) =>
    b.createdAt.getTime() - a.createdAt.getTime();

  // T-3.13: a curator-set `displayRank` overrides the bucket's default
  // tiebreaker. NULL ranks sort after any non-NULL rank within the same
  // bucket, then fall through to the bucket-specific secondary sort.
  // The personal bucket doesn't accept curator reordering — it's
  // viewer-private — so it ignores displayRank entirely.
  const byDisplayRankThen =
    (fallback: (a: TranslationWithVotes, b: TranslationWithVotes) => number) =>
    (a: TranslationWithVotes, b: TranslationWithVotes): number => {
      const ar = a.displayRank;
      const br = b.displayRank;
      if (ar !== null && br !== null) {
        if (ar !== br) return ar - br;
        return fallback(a, b);
      }
      if (ar !== null) return -1;
      if (br !== null) return 1;
      return fallback(a, b);
    };

  personal.sort(byCreatedAtAsc);
  official.sort(
    byDisplayRankThen((a, b) => {
      // Curator edits sort ahead of raw imports; within each tier,
      // oldest-first keeps the reader pop-up stable across renders.
      const sourceRank = (s: Translation['source']) => (s === 'curator' ? 0 : 1);
      const diff = sourceRank(a.source) - sourceRank(b.source);
      return diff !== 0 ? diff : byCreatedAtAsc(a, b);
    }),
  );
  community.sort(
    byDisplayRankThen((a, b) => {
      const scoreDiff = (b.voteScore ?? 0) - (a.voteScore ?? 0);
      return scoreDiff !== 0 ? scoreDiff : byCreatedAtDesc(a, b);
    }),
  );

  return {
    personal: personal.map((r) => toPublicTranslation(r, viewer)),
    official: official.map((r) => toPublicTranslation(r, viewer)),
    community: community.map((r) => toPublicTranslation(r, viewer)),
  };
}

function unwrapRows<T>(out: unknown): T[] {
  if (Array.isArray(out)) return out as T[];
  if (out && typeof out === 'object' && 'rows' in out) {
    const rows = (out as { rows?: T[] }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

async function attachVoteData(
  rows: Translation[],
  viewer: { id: string } | null,
): Promise<TranslationWithVotes[]> {
  const communityIds = rows
    .filter((r) => r.source === 'user')
    .map((r) => r.id);
  if (communityIds.length === 0) return rows;

  const scoreRows = unwrapRows<{
    translation_id: string;
    score: number | string | null;
  }>(
    await db.execute(sql`
      SELECT
        translation_id,
        COALESCE(
          SUM(CASE WHEN value = 'up' THEN 1 WHEN value = 'down' THEN -1 ELSE 0 END),
          0
        )::int AS score
      FROM translation_votes
      WHERE translation_id IN (${sql.join(
        communityIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      GROUP BY translation_id
    `),
  );
  const scores = new Map(
    scoreRows.map((r) => [r.translation_id, Number(r.score ?? 0)]),
  );

  const viewerVotes = new Map<string, TranslationVoteValue>();
  if (viewer) {
    const voteRows = await db
      .select({
        translationId: schema.translationVotes.translationId,
        value: schema.translationVotes.value,
      })
      .from(schema.translationVotes)
      .where(
        and(
          eq(schema.translationVotes.userId, viewer.id),
          sql`${schema.translationVotes.translationId} IN (${sql.join(
            communityIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
    for (const row of voteRows) {
      viewerVotes.set(row.translationId, row.value as TranslationVoteValue);
    }
  }

  return rows.map((row) => ({
    ...row,
    voteScore: row.source === 'user' ? (scores.get(row.id) ?? 0) : 0,
    viewerVote: row.source === 'user'
      ? (viewerVotes.get(row.id) ?? null)
      : null,
  }));
}

export class LemmaNotFoundError extends Error {
  constructor(public readonly lemmaId: string) {
    super(`Lemma ${lemmaId} not found`);
    this.name = 'LemmaNotFoundError';
  }
}

export async function getLemmaTranslations(
  lemmaId: string,
  viewer: { id: string; role: User['role'] } | null,
): Promise<LemmaTranslationBuckets> {
  const [lemma] = await db
    .select()
    .from(schema.lemmas)
    .where(eq(schema.lemmas.id, lemmaId))
    .limit(1);
  if (!lemma) throw new LemmaNotFoundError(lemmaId);

  const primaryRows = await db
    .select()
    .from(schema.translations)
    .where(
      and(
        // T-14.7a: switched from the legacy `lemma_id` column to
        // the polymorphic (target_type, target_id) pair so the
        // legacy column can be dropped. Phrase translations
        // (target_type='phrase') are filtered out by this
        // explicit type predicate — the lemma reader path never
        // wants them.
        eq(schema.translations.targetType, 'lemma'),
        eq(schema.translations.targetId, lemmaId),
        // Hidden rows are filtered in memory via `bucketTranslations`
        // so curators still see them. The DB fetch returns everything
        // for this lemma; translations-per-lemma is bounded by
        // the pop-up UX anyway.
      ),
    );

  // T-3.14: when the directly-linked lemma has no translations of its
  // own, fall back to sibling lemmas (same language + same headword,
  // any POS). This matters because the NLP pipeline frequently tags a
  // word with a context-dependent POS — "पार्क" inside "ग्लेशियर नेशनल पार्क"
  // gets PROPN — while the dictionary entry that ships the gloss is
  // under a different POS (NOUN). The user clicked the token expecting
  // its meaning, not a metadata lecture about how the parser tagged
  // it. Only triggered on empty primaries so the cost is paid exactly
  // when it would otherwise be a dead-end click.
  //
  // #318: Two-stage fallback. First try exact-headword siblings
  // (T-3.14's original behavior). If that's also empty, try
  // nukta-stripped siblings — the directly-linked lemma might be a
  // nukta-stripped form (e.g. pre-#316 `पढना`) while the dictionary
  // entry that ships the gloss is under the canonical with-nukta
  // form (`पढ़ना`), or vice-versa. Both sides reduce to the same
  // stripped key, so the second tier finds the entry the first
  // tier's strict-equality `headword =` clause missed.
  const lemmaTyped = lemma as Lemma;
  let rows: Translation[] = primaryRows as Translation[];
  if (rows.length === 0) {
    const joined = await db
      .select({ translation: schema.translations })
      .from(schema.translations)
      .innerJoin(
        schema.lemmas,
        // T-14.7a: join on the polymorphic target_id (with the
        // target_type='lemma' filter) instead of the legacy
        // lemma_id column.
        eq(schema.translations.targetId, schema.lemmas.id),
      )
      .where(
        and(
          eq(schema.translations.targetType, 'lemma'),
          eq(schema.lemmas.language, lemmaTyped.language),
          eq(schema.lemmas.headword, lemmaTyped.headword),
          ne(schema.lemmas.id, lemmaId),
        ),
      );
    rows = joined.map((r) => r.translation as Translation);
  }
  if (rows.length === 0) {
    // #318: Run the nukta-stripped tier even when the linked
    // lemma's own headword has no nukta. The strict tier above
    // matched on `headword = X`, so it missed any sibling whose
    // headword has nuktas X lacks (e.g. linked lemma is `पढना` and
    // the canonical entry under `पढ़ना` ships the gloss). The
    // stripped column is nukta-free on both sides, so it catches
    // both directions of the mismatch.
    const stripped = stripNukta(lemmaTyped.headword);
    const joinedStripped = await db
      .select({ translation: schema.translations })
      .from(schema.translations)
      .innerJoin(
        schema.lemmas,
        // T-14.7a: same target_id-based join as the strict tier
        // above. The stripped tier inherits the type predicate
        // because phrase target rows wouldn't match any
        // `lemmas.id` anyway, but the explicit filter keeps the
        // query plan honest.
        eq(schema.translations.targetId, schema.lemmas.id),
      )
      .where(
        and(
          eq(schema.translations.targetType, 'lemma'),
          eq(schema.lemmas.language, lemmaTyped.language),
          eq(schema.lemmas.headwordNuktaStripped, stripped),
          ne(schema.lemmas.id, lemmaId),
        ),
      );
    rows = joinedStripped.map((r) => r.translation as Translation);
  }

  const rowsWithVotes = await attachVoteData(rows, viewer);

  const translations = bucketTranslations(rowsWithVotes, viewer);
  return {
    lemma: toPublicLemma(lemmaTyped),
    translations,
    definitionLanguages: distinctDefinitionLanguages(translations),
  };
}

/**
 * Sorted unique `targetLanguage` codes across the three visible buckets.
 * Visibility (hidden-row suppression) is already applied by
 * `bucketTranslations`, so flattening its output is correct here.
 */
export function distinctDefinitionLanguages(
  translations: LemmaTranslationBuckets['translations'],
): string[] {
  const seen = new Set<string>();
  for (const bucket of [
    translations.personal,
    translations.official,
    translations.community,
  ]) {
    for (const t of bucket) seen.add(t.targetLanguage);
  }
  return [...seen].sort();
}
