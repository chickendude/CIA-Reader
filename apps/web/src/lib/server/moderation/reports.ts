/**
 * Translation report queue service (T-11.1).
 *
 * Connects three pieces that already existed independently:
 *   - readers can flag a community translation (`source='user'`) via the
 *     reader pop-up — the only entry point that calls `submitReport`;
 *   - curators / admins triage the resulting queue at `/moderation/translations`;
 *   - the existing `setTranslationHidden` writes the audit trail when a
 *     translation gets hidden, so we don't duplicate that bookkeeping here.
 *
 * Design notes:
 *   - The viewer is passed in explicitly (`{ id, role, grantedLanguages? }`)
 *     rather than re-fetched, mirroring `curator.ts`. That keeps the service
 *     unit-testable without a session and lets the route layer decide where
 *     `grantedLanguages` comes from (parent layout in our case).
 *   - Curators are scoped to their granted languages via a join on `lemmas`.
 *     Admins see everything (the layout's `listGrantedLanguages` already
 *     returns all MVP languages for them, but we also accept a
 *     `viewer.grantedLanguages === 'all'` shortcut to avoid round-tripping).
 *   - `bulkResolveByTranslation('resolved_hidden')` calls `setTranslationHidden`
 *     first (which writes the `lemma_edit_history` audit) and then flips all
 *     open reports for that translation. If the second step fails, the next
 *     retry's `setTranslationHidden` short-circuits (already hidden) and the
 *     report flip succeeds — the flow is idempotent enough that a transaction
 *     wrapper isn't worth the cross-module refactor.
 *   - Submitter rate limit mirrors `translations.ts` shape: count rows in a
 *     rolling window. 10 reports / 24h is intentionally generous; the real
 *     pile-on guard is the unique `(reporter_id, translation_id)` index.
 */
import { and, count, desc, eq, gt, inArray } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import {
  CuratorValidationError,
  setTranslationHidden,
} from '../dictionary/curator.js';
import { ForbiddenError, isAdmin, isCuratorOrAdmin } from '../dictionary/permissions.js';
import { MissingReasonError } from '../dictionary/audit.js';
import type {
  Lemma,
  Translation,
  TranslationReport,
  User,
} from '../db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

export const MAX_REPORTS_PER_DAY = 10;
export const REPORT_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const MAX_NOTE_LEN = 500;

export type ReportReason = TranslationReport['reason'];
export type ReportStatus = TranslationReport['status'];

const REPORT_REASONS: ReportReason[] = [
  'spam',
  'incorrect',
  'offensive',
  'duplicate',
  'other',
];
const RESOLVABLE_BY_TRANSLATION: ReportStatus[] = ['resolved_hidden', 'resolved_kept'];

export type Viewer = Pick<User, 'id' | 'role'> & {
  /** Pre-resolved language grants. Admins typically pass `'all'` so the
   *  service skips the language filter entirely. */
  grantedLanguages?: LanguageCode[] | 'all';
};

export class ReportValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ReportValidationError';
  }
}

export class ReportRateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    public readonly limit: number = MAX_REPORTS_PER_DAY,
  ) {
    super('Translation report rate limit exceeded');
    this.name = 'ReportRateLimitError';
  }
}

export class ReportDuplicateError extends Error {
  constructor() {
    super('You have already reported this translation');
    this.name = 'ReportDuplicateError';
  }
}

function normalizeNote(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validateReason(reason: unknown): ReportReason {
  if (typeof reason !== 'string' || !REPORT_REASONS.includes(reason as ReportReason)) {
    throw new ReportValidationError(
      `reason must be one of: ${REPORT_REASONS.join(', ')}`,
    );
  }
  return reason as ReportReason;
}

function validateNote(raw: string | null | undefined): string | null {
  const note = normalizeNote(raw);
  if (note != null && note.length > MAX_NOTE_LEN) {
    throw new ReportValidationError(
      `note exceeds ${MAX_NOTE_LEN} characters`,
    );
  }
  return note;
}

async function loadTranslation(translationId: string): Promise<Translation> {
  const [row] = await db
    .select()
    .from(schema.translations)
    .where(eq(schema.translations.id, translationId))
    .limit(1);
  if (!row) {
    throw new ReportValidationError(
      `Translation ${translationId} not found`,
      404,
    );
  }
  return row as Translation;
}

async function assertUnderRateLimit(reporterId: string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - REPORT_WINDOW_MS);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.translationReports)
    .where(
      and(
        eq(schema.translationReports.reporterId, reporterId),
        gt(schema.translationReports.createdAt, since),
      ),
    );
  if (Number(n) >= MAX_REPORTS_PER_DAY) {
    throw new ReportRateLimitError(Math.ceil(REPORT_WINDOW_MS / 1_000));
  }
}

export type SubmitReportInput = {
  reason: ReportReason | string;
  note?: string | null;
};

/**
 * File a new report against a community translation. Refuses to report
 * already-hidden translations (404) — once hidden, the case is closed.
 * Officials/curator translations are not user-flaggable; they are edited
 * in place through the dictionary editor.
 */
export async function submitReport(
  reporter: Pick<User, 'id'>,
  translationId: string,
  input: SubmitReportInput,
  now: Date = new Date(),
): Promise<TranslationReport> {
  const reason = validateReason(input.reason);
  const note = validateNote(input.note);
  const translation = await loadTranslation(translationId);
  if (translation.hidden) {
    throw new ReportValidationError(
      `Translation ${translationId} is not reportable`,
      404,
    );
  }
  if (translation.source !== 'user') {
    throw new ReportValidationError(
      'Only community translations can be reported',
      409,
    );
  }
  await assertUnderRateLimit(reporter.id, now);

  try {
    const [row] = await db
      .insert(schema.translationReports)
      .values({
        translationId,
        reporterId: reporter.id,
        reason,
        note,
        status: 'open',
      })
      .returning();
    if (!row) throw new Error('Failed to insert report');
    return row as TranslationReport;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ReportDuplicateError();
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  // postgres-js wraps the underlying PG error; either layer may carry the code.
  const e = err as { code?: string; cause?: { code?: string } } | null | undefined;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

export type ListReportsFilter = {
  status?: ReportStatus;
  language?: LanguageCode;
  /** Limit the slice for pagination. Defaults to 100 — the queue is
   *  expected to be short; we'll add real pagination if it stops being. */
  limit?: number;
};

export type ListedReport = {
  report: TranslationReport;
  translation: Pick<Translation, 'id' | 'body' | 'hidden' | 'lemmaId' | 'source'>;
  lemma: Pick<Lemma, 'id' | 'language' | 'headword' | 'pos'>;
  reporterEmail: string | null;
  /** Total count of reports against the same translation (any status) —
   *  surfaces "this is the 5th report on this row" in the UI. */
  siblingReports: number;
};

function isViewerScopedToLanguage(viewer: Viewer, language: LanguageCode): boolean {
  if (isAdmin(viewer) || viewer.grantedLanguages === 'all') return true;
  return (viewer.grantedLanguages ?? []).includes(language);
}

/**
 * List queue entries. Defaults to status='open' (the action queue);
 * pass an explicit status to inspect closed cases. Curators get filtered
 * by their language grants — admins see everything.
 */
export async function listReports(
  viewer: Viewer,
  filter: ListReportsFilter = {},
): Promise<ListedReport[]> {
  if (!isCuratorOrAdmin(viewer)) {
    throw new ForbiddenError('Curator or admin role required');
  }
  const status: ReportStatus = filter.status ?? 'open';
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);

  // Build the base predicate. Admins bypass language scoping; curators
  // see only languages in their `curator_languages` grants. A curator
  // with zero grants gets an empty result without hitting the DB.
  const isAdminViewer = isAdmin(viewer) || viewer.grantedLanguages === 'all';
  const grantedLanguages =
    viewer.grantedLanguages === 'all' ? null : viewer.grantedLanguages ?? [];
  if (!isAdminViewer && (grantedLanguages ?? []).length === 0) return [];

  const wherePredicates = [eq(schema.translationReports.status, status)];
  if (filter.language) {
    if (!isViewerScopedToLanguage(viewer, filter.language)) {
      throw new ForbiddenError(
        `Not granted curator rights on ${filter.language}`,
      );
    }
    wherePredicates.push(eq(schema.lemmas.language, filter.language));
  } else if (!isAdminViewer && grantedLanguages) {
    wherePredicates.push(inArray(schema.lemmas.language, grantedLanguages));
  }

  const rows = await db
    .select({
      report: schema.translationReports,
      translation: {
        id: schema.translations.id,
        body: schema.translations.body,
        hidden: schema.translations.hidden,
        lemmaId: schema.translations.lemmaId,
        source: schema.translations.source,
      },
      lemma: {
        id: schema.lemmas.id,
        language: schema.lemmas.language,
        headword: schema.lemmas.headword,
        pos: schema.lemmas.pos,
      },
      reporterEmail: schema.users.email,
    })
    .from(schema.translationReports)
    .innerJoin(
      schema.translations,
      eq(schema.translationReports.translationId, schema.translations.id),
    )
    .innerJoin(schema.lemmas, eq(schema.translations.lemmaId, schema.lemmas.id))
    .leftJoin(schema.users, eq(schema.translationReports.reporterId, schema.users.id))
    .where(and(...wherePredicates))
    .orderBy(desc(schema.translationReports.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // Sibling count: any-status reports against the same translation. One
  // GROUP BY query keyed by translation_id keeps it to a single round-trip.
  const translationIds = Array.from(
    new Set(rows.map((r) => (r.translation as { id: string }).id)),
  );
  const siblingRows = await db
    .select({
      translationId: schema.translationReports.translationId,
      n: count(),
    })
    .from(schema.translationReports)
    .where(inArray(schema.translationReports.translationId, translationIds))
    .groupBy(schema.translationReports.translationId);
  const siblingByTranslation = new Map<string, number>(
    siblingRows.map((s) => [s.translationId as string, Number(s.n)]),
  );

  return rows.map((r) => ({
    report: r.report as TranslationReport,
    translation: r.translation as ListedReport['translation'],
    lemma: r.lemma as ListedReport['lemma'],
    reporterEmail: (r.reporterEmail as string | null) ?? null,
    siblingReports: siblingByTranslation.get(
      (r.translation as { id: string }).id,
    ) ?? 0,
  }));
}

async function loadReport(reportId: string): Promise<TranslationReport> {
  const [row] = await db
    .select()
    .from(schema.translationReports)
    .where(eq(schema.translationReports.id, reportId))
    .limit(1);
  if (!row) throw new ReportValidationError('Report not found', 404);
  return row as TranslationReport;
}

async function loadLemmaForTranslation(translationId: string): Promise<Lemma> {
  const [row] = await db
    .select({
      id: schema.lemmas.id,
      language: schema.lemmas.language,
      headword: schema.lemmas.headword,
      pos: schema.lemmas.pos,
      script: schema.lemmas.script,
      glossDefault: schema.lemmas.glossDefault,
      frequencyRank: schema.lemmas.frequencyRank,
      source: schema.lemmas.source,
      sourceAttribution: schema.lemmas.sourceAttribution,
      sourceId: schema.lemmas.sourceId,
      curatorLocked: schema.lemmas.curatorLocked,
      createdAt: schema.lemmas.createdAt,
      updatedAt: schema.lemmas.updatedAt,
    })
    .from(schema.lemmas)
    .innerJoin(
      schema.translations,
      eq(schema.translations.lemmaId, schema.lemmas.id),
    )
    .where(eq(schema.translations.id, translationId))
    .limit(1);
  if (!row) throw new ReportValidationError('Translation not found', 404);
  return row as Lemma;
}

async function requireViewerScope(
  viewer: Viewer,
  language: LanguageCode,
): Promise<void> {
  if (!isCuratorOrAdmin(viewer)) {
    throw new ForbiddenError('Curator or admin role required');
  }
  if (!isViewerScopedToLanguage(viewer, language)) {
    throw new ForbiddenError(`Not granted curator rights on ${language}`);
  }
}

export type ResolveSingleAction = 'dismiss';

/**
 * Close a single report without acting on the underlying translation.
 * Useful for "this is a duplicate of another open report" or "this report
 * is not actionable on its own". Use `bulkResolveByTranslation` when the
 * decision applies to the translation as a whole (hide / keep).
 */
export async function resolveReport(
  viewer: Viewer,
  reportId: string,
  action: ResolveSingleAction,
  resolutionNote?: string | null,
  now: Date = new Date(),
): Promise<TranslationReport> {
  if (!isCuratorOrAdmin(viewer)) {
    throw new ForbiddenError('Curator or admin role required');
  }
  if (action !== 'dismiss') {
    throw new ReportValidationError(`Unsupported action: ${action}`);
  }
  const report = await loadReport(reportId);
  if (report.status !== 'open') {
    throw new ReportValidationError(
      'Report is already resolved',
      409,
    );
  }
  const lemma = await loadLemmaForTranslation(report.translationId);
  await requireViewerScope(viewer, lemma.language);
  const note = validateNote(resolutionNote);
  const [updated] = await db
    .update(schema.translationReports)
    .set({
      status: 'dismissed',
      resolvedBy: viewer.id,
      resolvedAt: now,
      resolutionNote: note,
      updatedAt: now,
    })
    .where(eq(schema.translationReports.id, reportId))
    .returning();
  if (!updated) throw new Error('Report update returned no row');
  return updated as TranslationReport;
}

export type BulkResolveAction = 'resolved_hidden' | 'resolved_kept';

export type BulkResolveResult = {
  translation: Translation;
  reportsAffected: number;
  status: BulkResolveAction;
};

/**
 * Resolve all open reports against one translation in a single decision.
 *  - `resolved_hidden`: also flips `translations.hidden=true` via
 *    `setTranslationHidden` (which writes the `lemma_edit_history` audit
 *    row). Idempotent: if the translation is already hidden, the audit
 *    write short-circuits and only the report status flip runs.
 *  - `resolved_kept`: leaves the translation untouched; flags every open
 *    report on it as "reviewed and kept" so the queue clears.
 */
export async function bulkResolveByTranslation(
  viewer: Viewer,
  translationId: string,
  action: BulkResolveAction,
  resolutionNote?: string | null,
  now: Date = new Date(),
): Promise<BulkResolveResult> {
  if (!isCuratorOrAdmin(viewer)) {
    throw new ForbiddenError('Curator or admin role required');
  }
  if (!RESOLVABLE_BY_TRANSLATION.includes(action)) {
    throw new ReportValidationError(`Unsupported action: ${action}`);
  }
  const translation = await loadTranslation(translationId);
  const lemma = await loadLemmaForTranslation(translationId);
  await requireViewerScope(viewer, lemma.language);
  const note = validateNote(resolutionNote);

  let next: Translation = translation;
  if (action === 'resolved_hidden') {
    if (!note || note.length < 3) {
      throw new MissingReasonError();
    }
    try {
      next = await setTranslationHidden(viewer, translationId, true, note, now);
    } catch (err) {
      if (err instanceof CuratorValidationError) {
        throw new ReportValidationError(err.message, err.status);
      }
      throw err;
    }
  }

  const updatedReports = await db
    .update(schema.translationReports)
    .set({
      status: action,
      resolvedBy: viewer.id,
      resolvedAt: now,
      resolutionNote: note,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.translationReports.translationId, translationId),
        eq(schema.translationReports.status, 'open'),
      ),
    )
    .returning({ id: schema.translationReports.id });

  return {
    translation: next,
    reportsAffected: updatedReports.length,
    status: action,
  };
}

/**
 * DTO returned to the reporter after a successful submit. Strips the
 * reporter id (the caller already knows who they are) and the moderator
 * fields (always null at create time).
 */
export function publicReport(row: TranslationReport): {
  id: string;
  translationId: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: string;
} {
  return {
    id: row.id,
    translationId: row.translationId,
    reason: row.reason,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Lightweight count of reports the viewer has filed against a list of
 * translations — used by the reader pop-up to show "Reported" badges
 * across a session. Returns a Set of translationIds the viewer has
 * already reported (any status).
 */
export async function listReporterTranslationIds(
  reporterId: string,
  translationIds: string[],
): Promise<Set<string>> {
  if (translationIds.length === 0) return new Set();
  const rows = await db
    .select({ translationId: schema.translationReports.translationId })
    .from(schema.translationReports)
    .where(
      and(
        eq(schema.translationReports.reporterId, reporterId),
        inArray(schema.translationReports.translationId, translationIds),
      ),
    );
  return new Set(rows.map((r) => r.translationId as string));
}
