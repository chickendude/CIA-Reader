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
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Lemma, Translation, User } from '../db/schema.js';

export type PublicTranslation = {
  id: string;
  source: Translation['source'];
  submittedBy: string | null;
  parentTranslationId: string | null;
  body: string;
  targetLanguage: string;
  sourceAttribution: string | null;
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

function toPublicTranslation(row: Translation): PublicTranslation {
  return {
    id: row.id,
    source: row.source,
    submittedBy: row.submittedBy,
    parentTranslationId: row.parentTranslationId,
    body: row.body,
    targetLanguage: row.targetLanguage,
    sourceAttribution: row.sourceAttribution,
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

  personal.sort(byCreatedAtAsc);
  official.sort((a, b) => {
    // Curator edits sort ahead of raw imports; within each tier,
    // oldest-first keeps the reader pop-up stable across renders.
    const sourceRank = (s: Translation['source']) => (s === 'curator' ? 0 : 1);
    const diff = sourceRank(a.source) - sourceRank(b.source);
    return diff !== 0 ? diff : byCreatedAtAsc(a, b);
  });
  community.sort(byCreatedAtDesc);

  return {
    personal: personal.map(toPublicTranslation),
    official: official.map(toPublicTranslation),
    community: community.map(toPublicTranslation),
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

  const rows = await db
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

  return {
    lemma: toPublicLemma(lemma as Lemma),
    translations: bucketTranslations(rows as Translation[], viewer),
  };
}
