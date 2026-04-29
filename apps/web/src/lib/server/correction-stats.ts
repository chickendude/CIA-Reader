/**
 * Correction-quality stats (T-6.9).
 *
 * Backs the lightweight admin dashboard at /moderation/stats. Four
 * metric buckets:
 *
 *   - per-language correction rate (proxy for real-world lemma
 *     accuracy: lower correction rate ⇒ higher accuracy).
 *   - top reported surfaces (head of the curator's queue).
 *   - parse-report backlog size by status.
 *   - median time-to-resolution on resolved reports.
 *
 * Pure SQL — no schema changes. Suitable for ad-hoc dashboard
 * loads; if the corpus grows large enough that any of these
 * queries hits seconds, we'd add a materialized view.
 */
import { sql } from 'drizzle-orm';

import { db } from './db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type LanguageAccuracy = {
  language: LanguageCode;
  totalTokens: number;
  correctedTokens: number;
  correctionRate: number;
  estimatedAccuracy: number;
};

/**
 * Per-language correction rate. We compute "estimated accuracy" as
 * `1 - corrections / tokens` — a back-of-the-envelope read on how
 * often the worker's parse needed a manual fix. Tokens that no one
 * has read yet contribute a 0 in the numerator, so the metric
 * trends with reader engagement; useful as a relative signal across
 * languages, not an absolute number.
 */
export async function getAccuracyByLanguage(): Promise<LanguageAccuracy[]> {
  const rows = (await db.execute(sql<{
    language: LanguageCode;
    total_tokens: number;
    corrected_tokens: number;
  }>`
    SELECT
      tx.language AS language,
      COUNT(tt.*)::int AS total_tokens,
      COUNT(tc.*)::int AS corrected_tokens
    FROM texts tx
    INNER JOIN text_chapters ch ON ch.text_id = tx.id
    INNER JOIN text_tokens tt ON tt.chapter_id = ch.id
    LEFT JOIN token_corrections tc ON tc.token_id = tt.id
    GROUP BY tx.language
  `)) as unknown as Array<{
    language: LanguageCode;
    total_tokens: number;
    corrected_tokens: number;
  }> | { rows: Array<{
    language: LanguageCode;
    total_tokens: number;
    corrected_tokens: number;
  }> };
  const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return list.map((r) => {
    const rate = r.total_tokens === 0 ? 0 : r.corrected_tokens / r.total_tokens;
    return {
      language: r.language,
      totalTokens: r.total_tokens,
      correctedTokens: r.corrected_tokens,
      correctionRate: rate,
      estimatedAccuracy: Math.max(0, 1 - rate),
    };
  });
}

export type ReportedSurface = {
  language: LanguageCode;
  surfaceNfc: string;
  reportCount: number;
  totalDuplicates: number;
};

/**
 * Top-N most-reported surfaces. We sum `duplicate_count` across all
 * statuses so a surface with 50 dupes spread over 5 reports floats
 * to the top, even if the curator has resolved most of them.
 */
export async function topReportedSurfaces(
  language: LanguageCode | null,
  limit = 10,
): Promise<ReportedSurface[]> {
  const langClause = language ? sql`WHERE language = ${language}` : sql``;
  const rows = (await db.execute(sql<{
    language: LanguageCode;
    surface_nfc: string;
    report_count: number;
    total_duplicates: number;
  }>`
    SELECT
      language,
      surface_nfc,
      COUNT(*)::int AS report_count,
      SUM(duplicate_count)::int AS total_duplicates
    FROM parse_reports
    ${langClause}
    GROUP BY language, surface_nfc
    ORDER BY total_duplicates DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    language: LanguageCode;
    surface_nfc: string;
    report_count: number;
    total_duplicates: number;
  }> | { rows: Array<{
    language: LanguageCode;
    surface_nfc: string;
    report_count: number;
    total_duplicates: number;
  }> };
  const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return list.map((r) => ({
    language: r.language,
    surfaceNfc: r.surface_nfc,
    reportCount: r.report_count,
    totalDuplicates: r.total_duplicates,
  }));
}

export type BacklogBucket = {
  language: LanguageCode;
  status: string;
  count: number;
};

export async function getBacklogSize(): Promise<BacklogBucket[]> {
  const rows = (await db.execute(sql<{
    language: LanguageCode;
    status: string;
    n: number;
  }>`
    SELECT language, status, COUNT(*)::int AS n
    FROM parse_reports
    GROUP BY language, status
  `)) as unknown as Array<{
    language: LanguageCode;
    status: string;
    n: number;
  }> | { rows: Array<{
    language: LanguageCode;
    status: string;
    n: number;
  }> };
  const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return list.map((r) => ({
    language: r.language,
    status: r.status,
    count: r.n,
  }));
}

export type ResolutionLatency = {
  language: LanguageCode;
  medianHours: number;
  resolvedCount: number;
};

/**
 * Median hours from `created_at` to `resolved_at` over reports
 * whose status flipped to resolved / rejected / duplicate. Uses
 * Postgres's `percentile_cont` so we get the true median, not the
 * average (which is sensitive to a single 6-month-old defer).
 */
export async function getMedianTimeToResolution(): Promise<ResolutionLatency[]> {
  const rows = (await db.execute(sql<{
    language: LanguageCode;
    median_hours: number | null;
    resolved_count: number;
  }>`
    SELECT
      language,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600
      ) AS median_hours,
      COUNT(*)::int AS resolved_count
    FROM parse_reports
    WHERE resolved_at IS NOT NULL
    GROUP BY language
  `)) as unknown as Array<{
    language: LanguageCode;
    median_hours: number | null;
    resolved_count: number;
  }> | { rows: Array<{
    language: LanguageCode;
    median_hours: number | null;
    resolved_count: number;
  }> };
  const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return list.map((r) => ({
    language: r.language,
    medianHours: r.median_hours == null ? 0 : Number(r.median_hours),
    resolvedCount: r.resolved_count,
  }));
}
