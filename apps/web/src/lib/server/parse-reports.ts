/**
 * parse_reports service (T-6.5).
 *
 * Two surface routines:
 *
 *  - `fileParseReport(...)` — used by the correction modal (T-6.2)
 *    when "Also report to moderators" is checked, by T-6.3's
 *    new-lemma proposal flow, and by T-6.7's aggregation worker.
 *    Implements the duplicate-merging contract: a new report whose
 *    `(language, surface_nfc, context_signature, corrected_lemma_id)`
 *    matches an existing open / triaged row increments that row's
 *    `duplicate_count` instead of creating a new row. Resolved /
 *    rejected rows do NOT collide — that lets the system re-open
 *    a conversation after a curator decision if the issue resurfaces.
 *
 *  - `listOpenParseReports(...)` — paged list for T-6.6's curator
 *    moderation UI. Filters by language + status + (optional)
 *    correction_type so the queue stays scannable.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import type { ParseReport, TokenCorrection } from './db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type FileParseReportInput = {
  reporterId: string | null;
  tokenId: string | null;
  language: LanguageCode;
  surfaceNfc: string;
  contextSignature?: string;
  originalCandidates: Array<{
    lemmaId: string | null;
    score: number;
    features: Record<string, string>;
  }>;
  correctedLemmaId: string | null;
  correctionType: TokenCorrection['type'];
  note?: string | null;
  /** Bypass the dedup-merge path and create a triaged-status row
   *  directly. Used by T-6.7's aggregation worker so a system-filed
   *  report doesn't masquerade as a duplicate of a manual one. */
  initialStatus?: ParseReport['status'];
};

const OPEN_STATUSES = ['open', 'triaged'] as const;

/**
 * Upsert a parse report. Returns the canonical row + a flag
 * reporting whether this call merged into an existing report
 * (`merged=true`) or created a new one (`merged=false`). Callers
 * use the flag to decide UX copy ("Reported" vs "Added to existing
 * report").
 */
export async function fileParseReport(
  input: FileParseReportInput,
): Promise<{ report: ParseReport; merged: boolean }> {
  const contextSignature = input.contextSignature ?? '';
  // Dedup lookup: same `(language, surface_nfc, context_signature,
  // corrected_lemma_id)` AND status open / triaged. The four-column
  // tuple matches the schema's dedup index so this is a single
  // index hit.
  //
  // We compare corrected_lemma_id with `IS NOT DISTINCT FROM` so a
  // null-on-both side (mark_* corrections) merges correctly.
  const existing = (await db
    .select()
    .from(schema.parseReports)
    .where(
      and(
        eq(schema.parseReports.language, input.language),
        eq(schema.parseReports.surfaceNfc, input.surfaceNfc),
        eq(schema.parseReports.contextSignature, contextSignature),
        sql`${schema.parseReports.correctedLemmaId} IS NOT DISTINCT FROM ${input.correctedLemmaId}`,
        inArray(
          schema.parseReports.status,
          OPEN_STATUSES as unknown as ParseReport['status'][],
        ),
      ),
    )
    .limit(1)) as ParseReport[];

  if (existing.length > 0) {
    const row = existing[0]!;
    const [updated] = await db
      .update(schema.parseReports)
      .set({
        duplicateCount: row.duplicateCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.parseReports.id, row.id))
      .returning();
    if (!updated) throw new Error('parse_report update returned no row');
    return { report: updated as ParseReport, merged: true };
  }

  const [created] = await db
    .insert(schema.parseReports)
    .values({
      reporterId: input.reporterId,
      tokenId: input.tokenId,
      language: input.language,
      surfaceNfc: input.surfaceNfc,
      contextSignature,
      originalCandidates: input.originalCandidates,
      correctedLemmaId: input.correctedLemmaId,
      correctionType: input.correctionType,
      note: input.note ?? null,
      status: input.initialStatus ?? 'open',
    })
    .returning();
  if (!created) throw new Error('parse_report insert returned no row');
  return { report: created as ParseReport, merged: false };
}

export type ListParseReportsFilter = {
  language?: LanguageCode;
  status?: ParseReport['status'];
  correctionType?: TokenCorrection['type'];
  limit?: number;
  offset?: number;
};

/**
 * Paged list for the curator moderation UI (T-6.6). Sorted by
 * `(duplicate_count DESC, updated_at DESC)` so the most-corroborated
 * reports float to the top.
 */
export async function listParseReports(
  filter: ListParseReportsFilter,
): Promise<ParseReport[]> {
  const where = [] as unknown[];
  if (filter.language) {
    where.push(eq(schema.parseReports.language, filter.language));
  }
  if (filter.status) {
    where.push(eq(schema.parseReports.status, filter.status));
  }
  if (filter.correctionType) {
    where.push(eq(schema.parseReports.correctionType, filter.correctionType));
  }
  let q = db.select().from(schema.parseReports).$dynamic();
  if (where.length > 0) {
    q = q.where(and(...(where as Parameters<typeof and>))) as typeof q;
  }
  const rows = (await q
    .orderBy(
      desc(schema.parseReports.duplicateCount),
      desc(schema.parseReports.updatedAt),
    )
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0)) as ParseReport[];
  return rows;
}
