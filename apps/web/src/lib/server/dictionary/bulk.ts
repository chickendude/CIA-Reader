/**
 * Bulk curator tools (T-3.9).
 *
 * Three operations the curator dashboard offers when one-row-at-a-time
 * editing isn't enough:
 *
 *  - `bulkImportTranslations`: a CSV-shaped feed of curator-written
 *     glosses. Each row resolves to an existing lemma by
 *     `(language, headword, pos)` (the unique constraint columns) and
 *     inserts a new `source='curator'` translation. Rows that don't
 *     resolve are skipped and reported back so the curator can fix
 *     their CSV instead of the import silently dropping data.
 *
 *  - `bulkPromoteTranslations`: take a list of `source='user'` rows
 *     and re-tag them as `source='curator'` in one pass. Same one-way
 *     transition guard as `updateTranslation` (rejects officials).
 *
 *  - `bulkUpdateAttribution`: rewrite `sourceAttribution` on every
 *     translation matching `(source, oldAttribution, language?)`. Used
 *     when an upstream source renames or rebrands and we want every
 *     imported row's badge to refresh in one shot.
 *
 * Every operation requires a single reason and writes one
 * `lemma_edit_history` row PER affected translation, so the audit log
 * still answers "what changed and why" at the row granularity.
 *
 * Permission model: bulk operations are admin-only. A per-language
 * curator wouldn't have rights on every row a bulk update could touch
 * (e.g. a CSV that mixes Hindi and Marathi rows would partially fail
 * for them in surprising ways). Restricting to admin sidesteps the
 * sharp edges; we can relax later if curators ask for it.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { recordLemmaEdit } from './audit.js';
import { ForbiddenError, isAdmin } from './permissions.js';
import { CuratorValidationError } from './curator.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { Lemma, Translation, User } from '../db/schema.js';

type Editor = Pick<User, 'id' | 'role'>;

/**
 * Common bulk-input cap. A single bulk request must not be a denial-of-
 * service vector for the curator tooling — 1000 rows is enough for any
 * realistic dictionary import in one go and small enough to fit
 * comfortably in a single Postgres transaction's lock budget.
 */
export const BULK_LIMIT = 1000;

const MIN_REASON_LEN = 3;

function requireAdminEditor(editor: Editor): void {
  if (!isAdmin(editor)) {
    throw new ForbiddenError('Bulk operations require admin role');
  }
}

function requireReason(reason: string): string {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < MIN_REASON_LEN) {
    throw new CuratorValidationError('reason is required (≥3 chars)');
  }
  return trimmed;
}

// -----------------------------------------------------------------------
// CSV import
// -----------------------------------------------------------------------

export type BulkImportRow = {
  language: string;
  headword: string;
  pos: string;
  body: string;
  /** ISO 2- or 3-letter code; defaults to 'en'. */
  targetLanguage?: string;
  /** Optional human-readable attribution. Falls back to the import
   *  attribution at the call site if omitted. */
  sourceAttribution?: string | null;
};

export type BulkImportResult = {
  inserted: number;
  /** 1-based row number → reason. The curator sees this and re-uploads
   *  a fixed CSV; we do NOT auto-create lemmas here (use the dictionary
   *  editor or the proposal flow for that). */
  skipped: Array<{ row: number; reason: string }>;
};

/** Maximum length of a single CSV-imported gloss. Mirrors the per-row
 *  cap in `translations.ts`. */
const MAX_BODY_LEN = 500;

function normalizeBody(body: string): string {
  return body.trim().replace(/\s+/g, ' ');
}

function normalizeHeadword(raw: string): string {
  return raw.normalize('NFC').trim();
}

function isLanguageCode(s: string): s is LanguageCode {
  return s === 'hi' || s === 'mr' || s === 'or';
}

export async function bulkImportTranslations(
  editor: Editor,
  rows: BulkImportRow[],
  reason: string,
  defaults: { sourceAttribution?: string | null } = {},
  now: Date = new Date(),
): Promise<BulkImportResult> {
  requireAdminEditor(editor);
  const trimmedReason = requireReason(reason);
  if (rows.length === 0) {
    throw new CuratorValidationError('rows is empty');
  }
  if (rows.length > BULK_LIMIT) {
    throw new CuratorValidationError(
      `bulk import is capped at ${BULK_LIMIT} rows (got ${rows.length})`,
    );
  }

  const skipped: BulkImportResult['skipped'] = [];
  let inserted = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const rowNumber = i + 1;

    const language = row.language?.toLowerCase().trim();
    if (!language || !isLanguageCode(language)) {
      skipped.push({ row: rowNumber, reason: `unsupported language '${row.language}'` });
      continue;
    }
    const headword = normalizeHeadword(row.headword ?? '');
    if (headword.length === 0) {
      skipped.push({ row: rowNumber, reason: 'empty headword' });
      continue;
    }
    const pos = (row.pos ?? '').trim();
    if (pos.length === 0) {
      skipped.push({ row: rowNumber, reason: 'empty pos' });
      continue;
    }
    const body = normalizeBody(row.body ?? '');
    if (body.length === 0) {
      skipped.push({ row: rowNumber, reason: 'empty body' });
      continue;
    }
    if (body.length > MAX_BODY_LEN) {
      skipped.push({
        row: rowNumber,
        reason: `body exceeds ${MAX_BODY_LEN} chars`,
      });
      continue;
    }
    const targetLanguage = (row.targetLanguage ?? 'en').toLowerCase().trim();
    if (!/^[a-z]{2,3}$/.test(targetLanguage)) {
      skipped.push({
        row: rowNumber,
        reason: `invalid targetLanguage '${row.targetLanguage}'`,
      });
      continue;
    }

    const [lemma] = (await db
      .select()
      .from(schema.lemmas)
      .where(
        and(
          eq(schema.lemmas.language, language),
          eq(schema.lemmas.headword, headword),
          eq(schema.lemmas.pos, pos),
        ),
      )
      .limit(1)) as Lemma[];
    if (!lemma) {
      skipped.push({
        row: rowNumber,
        reason: `lemma not found: (${language}, ${headword}, ${pos})`,
      });
      continue;
    }

    const [created] = (await db
      .insert(schema.translations)
      .values({
        lemmaId: lemma.id,
        // T-14.1: bulk-curator inserts are always lemma-target.
        // Phrase bulk import is a follow-up under T-14.4.
        targetType: 'lemma',
        targetId: lemma.id,
        source: 'curator',
        submittedBy: editor.id,
        body,
        targetLanguage,
        sourceAttribution:
          row.sourceAttribution !== undefined
            ? row.sourceAttribution
            : (defaults.sourceAttribution ?? null),
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as Translation[];
    if (!created) {
      skipped.push({ row: rowNumber, reason: 'insert failed' });
      continue;
    }

    await recordLemmaEdit({
      lemmaId: lemma.id,
      editorId: editor.id,
      changeType: 'translation_insert',
      change: {
        translationId: created.id,
        bulkImportRow: rowNumber,
        before: null,
        after: {
          source: 'curator',
          body,
          targetLanguage,
          sourceAttribution: created.sourceAttribution,
        },
      },
      reason: trimmedReason,
    });
    inserted += 1;
  }

  return { inserted, skipped };
}

// -----------------------------------------------------------------------
// Bulk promote
// -----------------------------------------------------------------------

export type BulkPromoteResult = {
  promoted: number;
  skipped: Array<{ id: string; reason: string }>;
};

export async function bulkPromoteTranslations(
  editor: Editor,
  translationIds: string[],
  reason: string,
  now: Date = new Date(),
): Promise<BulkPromoteResult> {
  requireAdminEditor(editor);
  const trimmedReason = requireReason(reason);
  if (translationIds.length === 0) {
    throw new CuratorValidationError('translationIds is empty');
  }
  if (translationIds.length > BULK_LIMIT) {
    throw new CuratorValidationError(
      `bulk promote is capped at ${BULK_LIMIT} ids (got ${translationIds.length})`,
    );
  }
  const dedup = Array.from(new Set(translationIds));

  const found = (await db
    .select()
    .from(schema.translations)
    .where(inArray(schema.translations.id, dedup))) as Translation[];
  const byId = new Map(found.map((t) => [t.id, t]));

  const skipped: BulkPromoteResult['skipped'] = [];
  let promoted = 0;

  for (const id of dedup) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, reason: 'not found' });
      continue;
    }
    if (row.source === 'curator') {
      skipped.push({ id, reason: 'already curator' });
      continue;
    }
    if (row.source === 'official_dictionary') {
      // Same one-way guard as updateTranslation: imported rows must be
      // edited directly, not re-tagged.
      skipped.push({ id, reason: 'imported officials cannot be re-tagged' });
      continue;
    }
    // T-14.1: bulk promote operates on lemma-target translations only.
    // Phrase-target community translations move through the phrase
    // editor (T-14.4 / T-14.7).
    if (row.targetType !== 'lemma' || !row.lemmaId) {
      skipped.push({ id, reason: 'phrase-target translations not supported here' });
      continue;
    }

    const [updated] = (await db
      .update(schema.translations)
      .set({ source: 'curator', updatedAt: now })
      .where(eq(schema.translations.id, id))
      .returning()) as Translation[];
    if (!updated) {
      skipped.push({ id, reason: 'update failed' });
      continue;
    }
    await recordLemmaEdit({
      lemmaId: row.lemmaId,
      editorId: editor.id,
      changeType: 'translation_update',
      change: {
        translationId: id,
        bulkPromote: true,
        before: { source: row.source },
        after: { source: 'curator' },
      },
      reason: trimmedReason,
    });
    promoted += 1;
  }

  return { promoted, skipped };
}

// -----------------------------------------------------------------------
// Bulk attribution update
// -----------------------------------------------------------------------

export type BulkAttributionInput = {
  /** Which translation source class to target. */
  source: 'official_dictionary' | 'curator';
  /** The current attribution string to find and replace. Required —
   *  matching every NULL row here would be too easy to do by accident. */
  oldAttribution: string;
  /** The new attribution string. `null` clears the field. */
  newAttribution: string | null;
  /** Optional language scope. Omit to update across every language. */
  language?: LanguageCode;
};

export type BulkAttributionResult = {
  updated: number;
};

export async function bulkUpdateAttribution(
  editor: Editor,
  input: BulkAttributionInput,
  reason: string,
  now: Date = new Date(),
): Promise<BulkAttributionResult> {
  requireAdminEditor(editor);
  const trimmedReason = requireReason(reason);
  if (!input.oldAttribution || input.oldAttribution.trim().length === 0) {
    throw new CuratorValidationError('oldAttribution is required');
  }

  const conditions = [
    eq(schema.translations.source, input.source),
    eq(schema.translations.sourceAttribution, input.oldAttribution),
  ];

  // Language scoping needs a join through lemmas; do it as a
  // pre-filtered id list rather than a SQL JOIN to keep the update
  // statement straightforward.
  let scopedIds: string[] | null = null;
  if (input.language) {
    const lemmaRows = await db
      .select({ id: schema.lemmas.id })
      .from(schema.lemmas)
      .where(eq(schema.lemmas.language, input.language));
    const lemmaIds = lemmaRows.map((r) => r.id);
    if (lemmaIds.length === 0) {
      return { updated: 0 };
    }
    const scoped = (await db
      .select({ id: schema.translations.id, lemmaId: schema.translations.lemmaId })
      .from(schema.translations)
      .where(
        and(
          eq(schema.translations.source, input.source),
          eq(schema.translations.sourceAttribution, input.oldAttribution),
          inArray(schema.translations.lemmaId, lemmaIds),
        ),
      )) as Array<{ id: string; lemmaId: string }>;
    scopedIds = scoped.map((r) => r.id);
    if (scopedIds.length === 0) {
      return { updated: 0 };
    }
  }

  // Snapshot the rows we're about to change so the audit-log diff
  // captures the before-state per row.
  const before = (await db
    .select()
    .from(schema.translations)
    .where(
      scopedIds
        ? and(...conditions, inArray(schema.translations.id, scopedIds))
        : and(...conditions),
    )) as Translation[];

  if (before.length === 0) {
    return { updated: 0 };
  }
  if (before.length > BULK_LIMIT) {
    throw new CuratorValidationError(
      `bulk attribution would touch ${before.length} rows (cap ${BULK_LIMIT}); narrow the filter`,
    );
  }

  await db
    .update(schema.translations)
    .set({ sourceAttribution: input.newAttribution, updatedAt: now })
    .where(
      scopedIds
        ? and(...conditions, inArray(schema.translations.id, scopedIds))
        : and(...conditions),
    );

  for (const row of before) {
    // T-14.1: bulk-attribution audit only fires for lemma-target
    // rows; phrase-target rebrands happen in T-14.7's phrase editor.
    if (row.targetType !== 'lemma' || !row.lemmaId) continue;
    await recordLemmaEdit({
      lemmaId: row.lemmaId,
      editorId: editor.id,
      changeType: 'translation_update',
      change: {
        translationId: row.id,
        bulkAttribution: true,
        before: { sourceAttribution: row.sourceAttribution },
        after: { sourceAttribution: input.newAttribution },
      },
      reason: trimmedReason,
    });
  }

  return { updated: before.length };
}
