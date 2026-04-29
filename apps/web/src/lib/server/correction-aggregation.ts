/**
 * Crowdsourced correction aggregation worker (T-6.7).
 *
 * Scans recent `token_corrections` rows grouped by
 * `(language, surface_nfc, context_signature, chosen_lemma_id)`
 * and promotes consensus picks. A group qualifies when:
 *
 *   - distinct user count ≥ MIN_DISTINCT_USERS (default 5), AND
 *   - that group's vote share is ≥ MIN_MAJORITY (default 70%) of
 *     all corrections on the same `(language, surface_nfc,
 *     context_signature)` triple.
 *
 * Promotion is twofold:
 *
 *   1. UPSERT a `form_lemma_overrides` row so the worker + reader
 *      apply the consensus pick going forward (the table's unique
 *      tuple is `(language, surface_nfc, context_signature)`).
 *   2. File a `parse_reports` row at status='triaged' (so the
 *      curator dashboard surfaces it as a system-flagged
 *      consensus). Dedup-merging stops a daily cron from
 *      multiplying these reports.
 *
 * The worker is idempotent — re-running on the same data is a
 * no-op aside from `updated_at` bumps. Suitable for a daily cron.
 */
import { sql } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import { fileParseReport } from './parse-reports.js';
import type { LanguageCode } from '@ciareader/shared-types';

export const DEFAULT_MIN_DISTINCT_USERS = 5;
export const DEFAULT_MIN_MAJORITY = 0.7;

export type AggregationOptions = {
  minDistinctUsers?: number;
  minMajority?: number;
  /** Limit how far back the worker scans `token_corrections`.
   *  Default: 60 days. The rolling window keeps very-old user
   *  picks from skewing the consensus after a curator decision
   *  already shipped a different override. */
  sinceDaysAgo?: number;
};

export type AggregationResult = {
  scanned: number;
  qualifyingGroups: number;
  overridesUpserted: number;
  reportsFiled: number;
};

/**
 * Internal row shape returned by the SQL aggregation. Each row
 * represents one (language, surface_nfc, context_signature,
 * chosen_lemma_id) bucket plus the totals we need to apply the
 * threshold checks.
 */
type GroupRow = {
  language: LanguageCode;
  surfaceNfc: string;
  contextSignature: string;
  chosenLemmaId: string | null;
  distinctUsers: number;
  totalDistinctUsers: number;
  voteCount: number;
};

export async function runCorrectionAggregation(
  options: AggregationOptions = {},
): Promise<AggregationResult> {
  const minUsers = options.minDistinctUsers ?? DEFAULT_MIN_DISTINCT_USERS;
  const minMajority = options.minMajority ?? DEFAULT_MIN_MAJORITY;
  const sinceDays = options.sinceDaysAgo ?? 60;

  // Single SQL query computes the bucket counts AND the per-triple
  // total in one window — avoids round-tripping for every group.
  // We exclude `mark_*` corrections because they aren't lemma
  // picks; the aggregation worker promotes lemma corrections.
  const rows = (await db.execute(sql<{
    language: LanguageCode;
    surface_nfc: string;
    context_signature: string;
    chosen_lemma_id: string | null;
    distinct_users: number;
    total_distinct_users: number;
    vote_count: number;
  }>`
    WITH base AS (
      SELECT
        tt.surface AS surface_nfc,
        tx.language AS language,
        '' AS context_signature,
        tc.chosen_lemma_id AS chosen_lemma_id,
        tc.user_id AS user_id
      FROM token_corrections tc
      INNER JOIN text_tokens tt ON tt.id = tc.token_id
      INNER JOIN text_chapters ch ON ch.id = tt.chapter_id
      INNER JOIN texts tx ON tx.id = ch.text_id
      WHERE tc.type IN ('pick_candidate', 'manual_lemma')
        AND tc.chosen_lemma_id IS NOT NULL
        AND tc.updated_at > NOW() - (${sinceDays} || ' days')::interval
    ),
    grouped AS (
      SELECT
        language,
        surface_nfc,
        context_signature,
        chosen_lemma_id,
        COUNT(DISTINCT user_id)::int AS distinct_users,
        COUNT(*)::int AS vote_count
      FROM base
      GROUP BY 1, 2, 3, 4
    ),
    totals AS (
      SELECT
        language,
        surface_nfc,
        context_signature,
        SUM(distinct_users)::int AS total_distinct_users
      FROM grouped
      GROUP BY 1, 2, 3
    )
    SELECT
      g.language,
      g.surface_nfc,
      g.context_signature,
      g.chosen_lemma_id,
      g.distinct_users,
      t.total_distinct_users,
      g.vote_count
    FROM grouped g
    INNER JOIN totals t USING (language, surface_nfc, context_signature)
  `)) as unknown as GroupRow[] | { rows: GroupRow[] };
  const list: GroupRow[] = Array.isArray(rows) ? rows : (rows.rows ?? []);

  let overridesUpserted = 0;
  let reportsFiled = 0;
  let qualifyingGroups = 0;
  const now = new Date();

  for (const r of list) {
    if (r.chosenLemmaId == null) continue;
    if (r.distinctUsers < minUsers) continue;
    const share = r.distinctUsers / Math.max(1, r.totalDistinctUsers);
    if (share < minMajority) continue;
    qualifyingGroups += 1;

    // 1. Upsert form_lemma_overrides.
    await db
      .insert(schema.formLemmaOverrides)
      .values({
        language: r.language,
        surfaceNfc: r.surfaceNfc,
        contextSignature: r.contextSignature,
        chosenLemmaId: r.chosenLemmaId,
        voteCount: r.distinctUsers,
        promotedAt: now,
        promotedBy: null,
        note: 'auto-promoted by T-6.7 aggregation worker',
      })
      .onConflictDoUpdate({
        target: [
          schema.formLemmaOverrides.language,
          schema.formLemmaOverrides.surfaceNfc,
          schema.formLemmaOverrides.contextSignature,
        ],
        set: {
          chosenLemmaId: r.chosenLemmaId,
          voteCount: r.distinctUsers,
          promotedAt: now,
        },
      });
    overridesUpserted += 1;

    // 2. Auto-file a triaged parse_report for curator sanity-check.
    await fileParseReport({
      reporterId: null,
      tokenId: null,
      language: r.language,
      surfaceNfc: r.surfaceNfc,
      contextSignature: r.contextSignature,
      originalCandidates: [],
      correctedLemmaId: r.chosenLemmaId,
      correctionType: 'manual_lemma',
      note: `auto-aggregation: ${r.distinctUsers}/${r.totalDistinctUsers} users (${(share * 100).toFixed(0)}%)`,
      initialStatus: 'triaged',
    });
    reportsFiled += 1;
  }

  return {
    scanned: list.length,
    qualifyingGroups,
    overridesUpserted,
    reportsFiled,
  };
}
