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
import type {
  FormLemmaOverride,
  ParseReport,
  TokenCorrection,
} from './db/schema.js';
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
 * Update a report's status. Resolution / rejection / defer all
 * route through here; `acceptParseReport` is the special branch
 * that ALSO writes a `form_lemma_overrides` row before updating.
 */
export type ResolveParseReportInput = {
  reportId: string;
  reviewerId: string;
  status: 'resolved' | 'rejected' | 'duplicate' | 'deferred' | 'triaged' | 'open';
  resolutionNote?: string | null;
  duplicateOfReportId?: string | null;
};

export class ParseReportValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = 'ParseReportValidationError';
  }
}

export async function resolveParseReport(
  input: ResolveParseReportInput,
): Promise<ParseReport> {
  if (
    (input.status === 'resolved' ||
      input.status === 'rejected' ||
      input.status === 'duplicate') &&
    !input.resolutionNote?.trim()
  ) {
    throw new ParseReportValidationError(
      'resolutionNote required for terminal statuses',
    );
  }
  const now = new Date();
  const isTerminal =
    input.status === 'resolved' ||
    input.status === 'rejected' ||
    input.status === 'duplicate';
  const [updated] = await db
    .update(schema.parseReports)
    .set({
      status: input.status,
      assignedReviewerId: input.reviewerId,
      resolutionNote: input.resolutionNote?.trim() || null,
      resolvedAt: isTerminal ? now : null,
      updatedAt: now,
    })
    .where(eq(schema.parseReports.id, input.reportId))
    .returning();
  if (!updated) {
    throw new ParseReportValidationError('report not found', 404);
  }
  return updated as ParseReport;
}

export type AcceptParseReportInput = {
  reportId: string;
  reviewerId: string;
  resolutionNote?: string | null;
};

export type AcceptParseReportResult = {
  report: ParseReport;
  override: FormLemmaOverride;
};

/**
 * "Accept for everyone" — promotes the report's correction into
 * `form_lemma_overrides` so the worker (and the reader fallback)
 * apply the chosen lemma to every future token matching
 * `(language, surface_nfc, context_signature)` AND flips the
 * report status to resolved.
 */
export async function acceptParseReport(
  input: AcceptParseReportInput,
): Promise<AcceptParseReportResult> {
  const [report] = (await db
    .select()
    .from(schema.parseReports)
    .where(eq(schema.parseReports.id, input.reportId))
    .limit(1)) as ParseReport[];
  if (!report) {
    throw new ParseReportValidationError('report not found', 404);
  }
  if (!report.correctedLemmaId) {
    throw new ParseReportValidationError(
      'report has no correctedLemmaId — accept is only valid for pick_candidate / manual_lemma reports',
    );
  }
  const now = new Date();

  // Upsert the form_lemma_override.
  const [override] = await db
    .insert(schema.formLemmaOverrides)
    .values({
      language: report.language,
      surfaceNfc: report.surfaceNfc,
      contextSignature: report.contextSignature,
      chosenLemmaId: report.correctedLemmaId,
      voteCount: report.duplicateCount,
      promotedAt: now,
      promotedBy: input.reviewerId,
      note: input.resolutionNote ?? null,
    })
    .onConflictDoUpdate({
      target: [
        schema.formLemmaOverrides.language,
        schema.formLemmaOverrides.surfaceNfc,
        schema.formLemmaOverrides.contextSignature,
      ],
      set: {
        chosenLemmaId: report.correctedLemmaId,
        voteCount: report.duplicateCount,
        promotedAt: now,
        promotedBy: input.reviewerId,
        note: input.resolutionNote ?? null,
      },
    })
    .returning();
  if (!override) throw new Error('form_lemma_overrides upsert returned no row');

  const [updated] = await db
    .update(schema.parseReports)
    .set({
      status: 'resolved',
      assignedReviewerId: input.reviewerId,
      resolvedAt: now,
      resolutionNote: input.resolutionNote ?? 'Accepted for everyone',
      updatedAt: now,
    })
    .where(eq(schema.parseReports.id, input.reportId))
    .returning();
  if (!updated) throw new Error('parse_reports update returned no row');
  return {
    report: updated as ParseReport,
    override: override as FormLemmaOverride,
  };
}

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
