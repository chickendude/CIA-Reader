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
import { and, eq, ne } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Lemma, Translation, User } from '../db/schema.js';

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
  row: Translation,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Bucket + sort translations for a single lemma under the rules
 * described at the top of this file. Exposed separately so the sorter
 * has unit tests that don't need to wire the DB mock.
 */
export function bucketTranslations(
  rows: Translation[],
  viewer: { id: string; role: User['role'] } | null,
): LemmaTranslationBuckets['translations'] {
  const canSeeHidden = viewer?.role === 'curator' || viewer?.role === 'admin';
  const visible = rows.filter((r) => !r.hidden || canSeeHidden);

  const personal: Translation[] = [];
  const official: Translation[] = [];
  const community: Translation[] = [];

  for (const row of visible) {
    if (viewer && row.source === 'user' && row.submittedBy === viewer.id) {
      personal.push(row);
    } else if (row.source === 'official_dictionary' || row.source === 'curator') {
      official.push(row);
    } else {
      community.push(row);
    }
  }

  const byCreatedAtAsc = (a: Translation, b: Translation) =>
    a.createdAt.getTime() - b.createdAt.getTime();
  const byCreatedAtDesc = (a: Translation, b: Translation) =>
    b.createdAt.getTime() - a.createdAt.getTime();

  // T-3.13: a curator-set `displayRank` overrides the bucket's default
  // tiebreaker. NULL ranks sort after any non-NULL rank within the same
  // bucket, then fall through to the bucket-specific secondary sort.
  // The personal bucket doesn't accept curator reordering — it's
  // viewer-private — so it ignores displayRank entirely.
  const byDisplayRankThen =
    (fallback: (a: Translation, b: Translation) => number) =>
    (a: Translation, b: Translation): number => {
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
  community.sort(byDisplayRankThen(byCreatedAtDesc));

  return {
    personal: personal.map((r) => toPublicTranslation(r, viewer)),
    official: official.map((r) => toPublicTranslation(r, viewer)),
    community: community.map((r) => toPublicTranslation(r, viewer)),
  };
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
        eq(schema.translations.lemmaId, lemmaId),
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
  const lemmaTyped = lemma as Lemma;
  let rows: Translation[] = primaryRows as Translation[];
  if (rows.length === 0) {
    const joined = await db
      .select({ translation: schema.translations })
      .from(schema.translations)
      .innerJoin(
        schema.lemmas,
        eq(schema.translations.lemmaId, schema.lemmas.id),
      )
      .where(
        and(
          eq(schema.lemmas.language, lemmaTyped.language),
          eq(schema.lemmas.headword, lemmaTyped.headword),
          ne(schema.lemmas.id, lemmaId),
        ),
      );
    rows = joined.map((r) => r.translation as Translation);
  }

  return {
    lemma: toPublicLemma(lemmaTyped),
    translations: bucketTranslations(rows, viewer),
  };
}
