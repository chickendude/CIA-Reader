/**
 * Transcription-workbench service (scan verification of imported
 * dictionary drafts).
 *
 * The DSAL importers land entries as live *drafts*; a curator verifies
 * each one against the public-domain page scan. Verification is
 * deliberately expressed through existing machinery:
 *
 *   verify = curator edit + `curator_locked = true`
 *            + own-transcription attribution
 *
 * The import runner already skips locked lemmas before touching them
 * or their translations, so a verified entry is permanently safe from
 * re-imports. Verification state is *derivable* — the unverified queue
 * is "lemmas whose source_id carries the dictionary's draft prefix and
 * that aren't locked" — so there are no verified-flag columns to keep
 * in sync. The audit trail is a single `transcription_verify` row in
 * `lemma_edit_history` carrying lemma + sense before/after plus the
 * scan page and crop the curator confirmed against.
 *
 * Effects go through a `TranscribeRepo` (default: Drizzle) so verify
 * semantics are unit-testable without chain mocks — the same pattern
 * as scans/ocr.ts.
 */
import { and, asc, count, eq, like, notExists, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { recordLemmaEdit } from './audit.js';
import type { RecordLemmaEditInput } from './audit.js';
import { CuratorValidationError } from './curator.js';
import { requireCanEditDictionary } from './permissions.js';
import { trimGloss } from './sources/dsal.js';
import { verifiedAttribution } from '../scans/registry.js';
import type { ScanDictionaryConfig } from '../scans/registry.js';
import { SCAN_DICTIONARIES } from '../scans/registry.js';
import type { Lemma, ScanCrop, ScanPage, Translation, TranscriptionIssue, User } from '../db/schema.js';

type Editor = Pick<User, 'id' | 'role'>;

export type VerifySense = {
  /** Present when this sense edits an existing translation row; absent
   *  inserts a new one. Rows the input omits are deleted. */
  translationId?: string;
  body: string;
  targetLanguage?: string;
};

export type VerifyTranscriptionInput = {
  headword: string;
  pos: string;
  glossDefault?: string | null;
  senses: VerifySense[];
  scanPageId: string;
  crop: ScanCrop;
};

export type QueueEntry = {
  lemmaId: string;
  headword: string;
  pos: string;
  glossDefault: string | null;
  sourceId: string;
  printedPage: number | null;
};

export type TranscriptionProgress = {
  total: number;
  verified: number;
  flagged: number;
};

export type TranscribeRepo = {
  loadLemma(id: string): Promise<Lemma | null>;
  /** The lemma's official-dictionary translations, display order. */
  loadOfficialTranslations(lemmaId: string): Promise<Translation[]>;
  loadScanPage(id: string): Promise<ScanPage | null>;
  updateLemma(id: string, set: Partial<Lemma>): Promise<Lemma>;
  updateTranslation(
    id: string,
    set: { body: string; targetLanguage: string; sourceAttribution: string; displayRank: number },
  ): Promise<Translation>;
  insertTranslation(values: {
    targetId: string;
    source: Lemma['source'];
    body: string;
    targetLanguage: string;
    sourceAttribution: string;
    sourceId: string;
    displayRank: number;
  }): Promise<Translation>;
  deleteTranslations(ids: string[]): Promise<void>;
  upsertScanRef(lemmaId: string, scanPageId: string, crop: ScanCrop, userId: string): Promise<void>;
  recordEdit(input: RecordLemmaEditInput): Promise<void>;
};

/* ------------------------------------------------------------------ */
/* Config resolution                                                   */
/* ------------------------------------------------------------------ */

/** The workbench config a lemma belongs to, by source_id prefix. */
export function configForLemma(lemma: Pick<Lemma, 'sourceId'>): ScanDictionaryConfig | null {
  const sourceId = lemma.sourceId ?? '';
  for (const config of Object.values(SCAN_DICTIONARIES)) {
    if (
      sourceId.startsWith(config.draftSourceIdPrefix) ||
      sourceId.startsWith(config.createdSourceIdPrefix)
    ) {
      return config;
    }
  }
  return null;
}

function validateCrop(crop: ScanCrop): void {
  const inUnit = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1;
  if (
    !inUnit(crop.x) ||
    !inUnit(crop.y) ||
    !inUnit(crop.w) ||
    !inUnit(crop.h) ||
    crop.w <= 0 ||
    crop.h <= 0 ||
    crop.x + crop.w > 1.000001 ||
    crop.y + crop.h > 1.000001
  ) {
    throw new CuratorValidationError('crop must be a normalized rectangle within the page');
  }
}

/* ------------------------------------------------------------------ */
/* verifyTranscription                                                 */
/* ------------------------------------------------------------------ */

export async function verifyTranscription(
  editor: Editor,
  lemmaId: string,
  input: VerifyTranscriptionInput,
  reason: string,
  repo: TranscribeRepo = drizzleTranscribeRepo,
  now: Date = new Date(),
): Promise<Lemma> {
  const lemma = await repo.loadLemma(lemmaId);
  if (!lemma) throw new CuratorValidationError(`Lemma ${lemmaId} not found`, 404);
  await requireCanEditDictionary(editor, lemma.language);

  const config = configForLemma(lemma);
  if (!config) {
    throw new CuratorValidationError('lemma is not part of a scan-backed dictionary');
  }

  const headword = input.headword.normalize('NFC').trim();
  if (!headword) throw new CuratorValidationError('headword cannot be empty');
  if (headword.length > 128) throw new CuratorValidationError('headword exceeds 128 characters');
  if (!input.pos.trim()) throw new CuratorValidationError('pos cannot be empty');
  const senses = input.senses
    .map((s) => ({ ...s, body: s.body.trim() }))
    .filter((s) => s.body.length > 0);
  if (senses.length === 0) {
    throw new CuratorValidationError('a verified entry needs at least one sense');
  }
  validateCrop(input.crop);

  const scanPage = await repo.loadScanPage(input.scanPageId);
  if (!scanPage) throw new CuratorValidationError('scan page not found', 404);

  const existingTranslations = await repo.loadOfficialTranslations(lemmaId);
  const existingById = new Map(existingTranslations.map((t) => [t.id, t]));
  for (const sense of senses) {
    if (sense.translationId && !existingById.has(sense.translationId)) {
      throw new CuratorValidationError(
        `translation ${sense.translationId} does not belong to this lemma`,
      );
    }
  }

  const attribution = verifiedAttribution(config, scanPage.printedPage);

  const beforeLemma = { ...lemma };
  const updatedLemma = await repo.updateLemma(lemmaId, {
    headword,
    pos: input.pos.trim(),
    glossDefault: input.glossDefault ?? trimGloss(senses[0]!.body),
    sourceAttribution: attribution,
    curatorLocked: true,
    updatedAt: now,
  });

  const keptIds = new Set<string>();
  const afterSenses: Array<Record<string, unknown>> = [];
  for (let i = 0; i < senses.length; i += 1) {
    const sense = senses[i]!;
    const targetLanguage = sense.targetLanguage ?? 'en';
    if (sense.translationId) {
      keptIds.add(sense.translationId);
      const updated = await repo.updateTranslation(sense.translationId, {
        body: sense.body,
        targetLanguage,
        sourceAttribution: attribution,
        displayRank: i,
      });
      afterSenses.push({ id: updated.id, body: sense.body, targetLanguage, displayRank: i });
    } else {
      const inserted = await repo.insertTranslation({
        targetId: lemmaId,
        source: lemma.source,
        body: sense.body,
        targetLanguage,
        sourceAttribution: attribution,
        sourceId: `${lemma.sourceId ?? lemmaId}:v${i}`,
        displayRank: i,
      });
      afterSenses.push({ id: inserted.id, body: sense.body, targetLanguage, displayRank: i });
    }
  }
  const removedIds = existingTranslations.filter((t) => !keptIds.has(t.id)).map((t) => t.id);
  if (removedIds.length > 0) await repo.deleteTranslations(removedIds);

  await repo.upsertScanRef(lemmaId, input.scanPageId, input.crop, editor.id);

  await repo.recordEdit({
    lemmaId,
    editorId: editor.id,
    changeType: 'transcription_verify',
    change: {
      before: {
        headword: beforeLemma.headword,
        pos: beforeLemma.pos,
        glossDefault: beforeLemma.glossDefault,
        sourceAttribution: beforeLemma.sourceAttribution,
        curatorLocked: beforeLemma.curatorLocked,
        senses: existingTranslations.map((t) => ({
          id: t.id,
          body: t.body,
          targetLanguage: t.targetLanguage,
        })),
      },
      after: {
        headword,
        pos: updatedLemma.pos,
        glossDefault: updatedLemma.glossDefault,
        sourceAttribution: attribution,
        curatorLocked: true,
        senses: afterSenses,
      },
      scanPageId: input.scanPageId,
      crop: { ...input.crop },
    },
    reason,
  });

  return updatedLemma;
}

/* ------------------------------------------------------------------ */
/* Queue / progress / page resolution (Drizzle-only reads)             */
/* ------------------------------------------------------------------ */

/** Printed page parsed from the tail of a draft source_id
 *  (`dsal:<dict>:<hw>:<page>:<ord>`); hash-fallback ids sort last. */
const printedPageSql = sql<number | null>`(substring(${schema.lemmas.sourceId} from ':(\\d+):\\d+$'))::int`;

/** TS twin of `printedPageSql` for single rows already in hand. */
export function printedPageFromSourceId(sourceId: string | null): number | null {
  const m = /:(\d+):\d+$/.exec(sourceId ?? '');
  return m ? Number(m[1]) : null;
}

export async function listTranscriptionQueue(
  config: ScanDictionaryConfig,
  opts: { fromPrintedPage?: number; limit?: number } = {},
): Promise<QueueEntry[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const openIssue = db
    .select({ id: schema.transcriptionIssues.id })
    .from(schema.transcriptionIssues)
    .where(
      and(
        eq(schema.transcriptionIssues.lemmaId, schema.lemmas.id),
        eq(schema.transcriptionIssues.status, 'open'),
      ),
    );

  const conditions = [
    eq(schema.lemmas.language, config.language),
    eq(schema.lemmas.source, 'official_dictionary'),
    like(schema.lemmas.sourceId, `${config.draftSourceIdPrefix}%`),
    eq(schema.lemmas.curatorLocked, false),
    notExists(openIssue),
  ];
  if (opts.fromPrintedPage !== undefined) {
    conditions.push(sql`${printedPageSql} >= ${opts.fromPrintedPage}`);
  }

  const rows = await db
    .select({
      lemmaId: schema.lemmas.id,
      headword: schema.lemmas.headword,
      pos: schema.lemmas.pos,
      glossDefault: schema.lemmas.glossDefault,
      sourceId: schema.lemmas.sourceId,
      printedPage: printedPageSql,
    })
    .from(schema.lemmas)
    .where(and(...conditions))
    .orderBy(sql`${printedPageSql} NULLS LAST`, asc(schema.lemmas.sourceId))
    .limit(limit);
  return rows as QueueEntry[];
}

export async function countTranscriptionProgress(
  config: ScanDictionaryConfig,
): Promise<TranscriptionProgress> {
  const draftPrefix = like(schema.lemmas.sourceId, `${config.draftSourceIdPrefix}%`);
  const [totals] = await db
    .select({
      total: count(),
      verified: count(sql`CASE WHEN ${schema.lemmas.curatorLocked} THEN 1 END`),
    })
    .from(schema.lemmas)
    .where(and(eq(schema.lemmas.language, config.language), draftPrefix));
  const [flagged] = await db
    .select({ flagged: count() })
    .from(schema.transcriptionIssues)
    .where(
      and(
        eq(schema.transcriptionIssues.dictionarySlug, config.slug),
        eq(schema.transcriptionIssues.status, 'open'),
      ),
    );
  return {
    total: totals?.total ?? 0,
    verified: totals?.verified ?? 0,
    flagged: flagged?.flagged ?? 0,
  };
}

/** Resolve a printed page number to its scan page: pick the volume
 *  covering the printed range, then the page row. */
export async function resolveScanPage(
  slug: string,
  printedPage: number,
): Promise<ScanPage | null> {
  const rows = await db
    .select({ page: schema.scanPages })
    .from(schema.scanPages)
    .innerJoin(schema.scanVolumes, eq(schema.scanPages.volumeId, schema.scanVolumes.id))
    .where(
      and(
        eq(schema.scanVolumes.dictionarySlug, slug),
        eq(schema.scanPages.printedPage, printedPage),
      ),
    )
    .limit(1);
  return (rows[0]?.page as ScanPage | undefined) ?? null;
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

export async function openTranscriptionIssue(
  editor: Editor,
  input: { dictionarySlug: string; lemmaId?: string; scanPageId?: string; note: string },
): Promise<TranscriptionIssue> {
  const config = SCAN_DICTIONARIES[input.dictionarySlug];
  if (!config) throw new CuratorValidationError('unknown dictionary');
  await requireCanEditDictionary(editor, config.language);
  const note = input.note.trim();
  if (!note) throw new CuratorValidationError('a note is required to flag a problem');

  const [row] = await db
    .insert(schema.transcriptionIssues)
    .values({
      dictionarySlug: input.dictionarySlug,
      lemmaId: input.lemmaId ?? null,
      scanPageId: input.scanPageId ?? null,
      note,
      createdBy: editor.id,
    })
    .returning();
  if (!row) throw new Error('Failed to open issue');
  return row as TranscriptionIssue;
}

export async function resolveTranscriptionIssue(
  editor: Editor,
  issueId: string,
): Promise<TranscriptionIssue> {
  const [issue] = await db
    .select()
    .from(schema.transcriptionIssues)
    .where(eq(schema.transcriptionIssues.id, issueId))
    .limit(1);
  if (!issue) throw new CuratorValidationError('issue not found', 404);
  const config = SCAN_DICTIONARIES[(issue as TranscriptionIssue).dictionarySlug];
  if (config) await requireCanEditDictionary(editor, config.language);

  const [updated] = await db
    .update(schema.transcriptionIssues)
    .set({ status: 'resolved', resolvedBy: editor.id, updatedAt: new Date() })
    .where(eq(schema.transcriptionIssues.id, issueId))
    .returning();
  return updated as TranscriptionIssue;
}

/* ------------------------------------------------------------------ */
/* Default Drizzle repo                                                */
/* ------------------------------------------------------------------ */

export const drizzleTranscribeRepo: TranscribeRepo = {
  async loadLemma(id) {
    const rows = await db.select().from(schema.lemmas).where(eq(schema.lemmas.id, id)).limit(1);
    return (rows[0] as Lemma | undefined) ?? null;
  },
  async loadOfficialTranslations(lemmaId) {
    const rows = await db
      .select()
      .from(schema.translations)
      .where(
        and(
          eq(schema.translations.targetType, 'lemma'),
          eq(schema.translations.targetId, lemmaId),
          eq(schema.translations.source, 'official_dictionary'),
        ),
      )
      .orderBy(asc(schema.translations.displayRank), asc(schema.translations.createdAt));
    return rows as Translation[];
  },
  async loadScanPage(id) {
    const rows = await db.select().from(schema.scanPages).where(eq(schema.scanPages.id, id)).limit(1);
    return (rows[0] as ScanPage | undefined) ?? null;
  },
  async updateLemma(id, set) {
    const [row] = await db.update(schema.lemmas).set(set).where(eq(schema.lemmas.id, id)).returning();
    if (!row) throw new Error('Failed to update lemma');
    return row as Lemma;
  },
  async updateTranslation(id, set) {
    const [row] = await db
      .update(schema.translations)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(schema.translations.id, id))
      .returning();
    if (!row) throw new Error('Failed to update translation');
    return row as Translation;
  },
  async insertTranslation(values) {
    const [row] = await db
      .insert(schema.translations)
      .values({ targetType: 'lemma', ...values })
      .returning();
    if (!row) throw new Error('Failed to insert translation');
    return row as Translation;
  },
  async deleteTranslations(ids) {
    for (const id of ids) {
      await db.delete(schema.translations).where(eq(schema.translations.id, id));
    }
  },
  async upsertScanRef(lemmaId, scanPageId, crop, userId) {
    await db
      .insert(schema.lemmaScanRefs)
      .values({ lemmaId, scanPageId, crop, createdBy: userId })
      .onConflictDoUpdate({
        target: schema.lemmaScanRefs.lemmaId,
        set: { scanPageId, crop, createdBy: userId, updatedAt: new Date() },
      });
  },
  async recordEdit(input) {
    await recordLemmaEdit(input);
  },
};
