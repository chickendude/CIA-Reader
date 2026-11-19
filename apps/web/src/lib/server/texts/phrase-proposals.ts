/**
 * Group the parser's proposals by language, spelling and pattern. Count distinct chapters so
 * repeated occurrences in one chapter cannot promote a phrase on their own.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { createPhrase } from '../phrases.js';
import type { LanguageCode } from '@ciareader/shared-types';

export const PHRASE_PROMOTION_MIN_CHAPTERS = Number(
  process.env.PHRASE_PROMOTION_MIN_CHAPTERS ?? 3,
);

// ---------------------------------------------------------------
// Worker-side: queue write.
// ---------------------------------------------------------------

export type WorkerProposal = {
  start_idx: number;
  end_idx: number;
  pattern_id: string;
  surfaces: string[];
};

export type UpsertProposalsInput = {
  chapterId: string;
  language: LanguageCode;
  proposals: WorkerProposal[];
};

/** Report failures to the caller so it can mark the text as failed and retry processing. */
export async function upsertPhraseProposals(
  input: UpsertProposalsInput,
): Promise<number> {
  if (input.proposals.length === 0) return 0;

  // De-dup within the batch first — a chapter can have the same
  // surface match twice (a phrase repeated in the chapter), but
  // for the proposals queue we only care that it occurred *at
  // all* in this chapter. Collapsing here keeps the
  // ON CONFLICT path from being exercised for every duplicate.
  const seen = new Map<string, WorkerProposal>();
  for (const p of input.proposals) {
    const surface = p.surfaces.map((s) => s.normalize('NFC')).join(' ');
    const key = `${surface}\0${p.pattern_id}`;
    if (!seen.has(key)) seen.set(key, p);
  }

  const rows = Array.from(seen.entries()).map(([key, p]) => {
    const [surface] = key.split('\0');
    return {
      language: input.language,
      surfaceNormalised: surface!,
      tokens: p.surfaces.map((s) => s.normalize('NFC')),
      patternId: p.pattern_id,
      chapterId: input.chapterId,
    };
  });

  // ON CONFLICT DO NOTHING on the unique constraint
  // `phrase_proposals_occurrence_uq` — a re-process of the same
  // chapter is a no-op.
  await db
    .insert(schema.phraseProposals)
    .values(rows)
    .onConflictDoNothing({
      target: [
        schema.phraseProposals.chapterId,
        schema.phraseProposals.surfaceNormalised,
        schema.phraseProposals.patternId,
      ],
    });
  return rows.length;
}

// ---------------------------------------------------------------
// Promotion pass.
// ---------------------------------------------------------------

export type PromotionResult = {
  /** How many `(language, surface_normalised)` groups crossed
   *  the threshold and produced (or reused) a `phrases` row. */
  promoted: number;
  /** How many proposal rows were stamped with `promoted_at` —
   *  may exceed `promoted` because each phrase has multiple
   *  chapter occurrences. */
  proposalsMarked: number;
  /** Surface a per-language breakdown for the admin endpoint's
   *  response so curators can see at a glance what just landed. */
  byLanguage: Record<string, number>;
};

/**
 * Walk the proposal queue and promote groups at or above
 * `PHRASE_PROMOTION_MIN_CHAPTERS`. Idempotent — proposals
 * already stamped `promoted_at` are excluded from the
 * aggregation, so re-running the pass is safe.
 *
 * Returns a summary so the admin endpoint can render a toast
 * and the cron job can log progress without re-querying.
 */
export async function promotePhraseProposals(args: {
  /** Override the global threshold for this run (admin escape
   *  hatch, e.g. backfilling against a sparse corpus). */
  minChapters?: number;
} = {}): Promise<PromotionResult> {
  const minChapters = args.minChapters ?? PHRASE_PROMOTION_MIN_CHAPTERS;

  // Count distinct chapters per (language, surface_normalised)
  // among UNPROMOTED proposals. The promotion pass aggregates
  // and then loops the eligible groups; with the
  // `phrase_proposals_promotion_lookup_idx` index this scan is
  // a single seq-of-merge.
  const groups = (await db
    .select({
      language: schema.phraseProposals.language,
      surfaceNormalised: schema.phraseProposals.surfaceNormalised,
      chapters: sql<number>`count(distinct ${schema.phraseProposals.chapterId})::int`,
    })
    .from(schema.phraseProposals)
    .where(isNull(schema.phraseProposals.promotedAt))
    .groupBy(
      schema.phraseProposals.language,
      schema.phraseProposals.surfaceNormalised,
    )) as Array<{
    language: LanguageCode;
    surfaceNormalised: string;
    chapters: number;
  }>;

  const eligible = groups.filter((g) => g.chapters >= minChapters);
  let promoted = 0;
  let proposalsMarked = 0;
  const byLanguage: Record<string, number> = {};

  for (const group of eligible) {
    // Pick any one proposal in the group to source the
    // `tokens` array — every proposal in the group has the
    // same surface_normalised so the ordered surfaces line up.
    const [sample] = (await db
      .select({
        tokens: schema.phraseProposals.tokens,
        patternId: schema.phraseProposals.patternId,
      })
      .from(schema.phraseProposals)
      .where(
        and(
          eq(schema.phraseProposals.language, group.language),
          eq(
            schema.phraseProposals.surfaceNormalised,
            group.surfaceNormalised,
          ),
          isNull(schema.phraseProposals.promotedAt),
        ),
      )
      .limit(1)) as Array<{ tokens: string[]; patternId: string }>;
    if (!sample) continue;

    // Reuse `createPhrase` so the dedupe path catches an
    // already-promoted-but-since-marked-back-to-null edge case
    // (manual SQL recovery). Source attribution captures the
    // pattern id so a curator can audit which patterns are
    // pulling their weight.
    const result = await createPhrase({
      language: group.language,
      tokens: sample.tokens,
      source: 'nlp',
      sourceAttribution: `pattern:${sample.patternId}`,
      bypassTokenCap: true,
    });

    // Stamp every proposal in the group with promoted_at so
    // future passes skip them. We update by (language,
    // surface_normalised, promotedAt IS NULL) to also catch
    // proposals that arrive after the first promotion (a
    // chapter processed later contributes one more occurrence
    // of an already-promoted phrase).
    const updateResult = await db
      .update(schema.phraseProposals)
      .set({
        promotedAt: new Date(),
        promotedPhraseId: result.phrase.id,
      })
      .where(
        and(
          eq(schema.phraseProposals.language, group.language),
          eq(
            schema.phraseProposals.surfaceNormalised,
            group.surfaceNormalised,
          ),
          isNull(schema.phraseProposals.promotedAt),
        ),
      )
      .returning({ id: schema.phraseProposals.id });

    promoted += 1;
    proposalsMarked += updateResult.length;
    byLanguage[group.language] = (byLanguage[group.language] ?? 0) + 1;
  }

  return { promoted, proposalsMarked, byLanguage };
}

// ---------------------------------------------------------------
// Read helper for the admin dashboard.
// ---------------------------------------------------------------

export type ProposalSummary = {
  language: LanguageCode;
  surfaceNormalised: string;
  patternId: string;
  chapters: number;
  promoted: boolean;
};

/** Count the distinct chapters supporting each proposed phrase. */
export async function summarizePhraseProposals(args: {
  language?: LanguageCode;
  limit?: number;
}): Promise<ProposalSummary[]> {
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = (await db
    .select({
      language: schema.phraseProposals.language,
      surfaceNormalised: schema.phraseProposals.surfaceNormalised,
      patternId: schema.phraseProposals.patternId,
      chapters: sql<number>`count(distinct ${schema.phraseProposals.chapterId})::int`,
      promoted: sql<boolean>`bool_or(${schema.phraseProposals.promotedAt} is not null)`,
    })
    .from(schema.phraseProposals)
    .where(
      args.language
        ? eq(schema.phraseProposals.language, args.language)
        : sql`true`,
    )
    .groupBy(
      schema.phraseProposals.language,
      schema.phraseProposals.surfaceNormalised,
      schema.phraseProposals.patternId,
    )
    .orderBy(sql`count(distinct ${schema.phraseProposals.chapterId}) desc`)
    .limit(limit)) as Array<{
    language: LanguageCode;
    surfaceNormalised: string;
    patternId: string;
    chapters: number;
    promoted: boolean;
  }>;
  return rows;
}
