/**
 * Curator dictionary editor service (T-3.7).
 *
 * Backs the `/moderation/dictionary` UI and the admin JSON endpoints.
 * Every mutating function here:
 *
 *  1. Resolves the affected lemma and checks
 *     `requireCanEditDictionary(editor, lemma.language)`. Curators only
 *     have write access on languages they've been granted; admins
 *     always pass.
 *  2. Captures a snapshot of the affected row(s) for the before/after
 *     diff that lands in `lemma_edit_history`.
 *  3. Writes the mutation, then records the audit row with a
 *     caller-supplied `reason` (required — empty reasons throw
 *     `MissingReasonError`).
 *
 * Scope note for merge/split: the plan (M6 + beyond) calls for rewiring
 * `text_tokens`, `user_known_lemmas`, and `form_lemma_overrides` across
 * the loser/winner split. Those tables don't exist yet — they land in
 * M5/M6. For now, merge rewires `translations` + `lemma_forms` only;
 * split moves selected `translations` + `lemma_forms`. The future
 * tickets that introduce those tables will extend these functions.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { recordLemmaEdit, MissingReasonError } from './audit.js';
import { requireCanEditDictionary } from './permissions.js';
import type {
  Lemma,
  LemmaForm,
  Translation,
  User,
} from '../db/schema.js';

export class CuratorValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'CuratorValidationError';
  }
}

type Editor = Pick<User, 'id' | 'role'>;

/**
 * Load a lemma or throw 404. Used at the start of every mutator so we
 * can check per-language curator rights before touching anything.
 */
async function loadLemma(id: string): Promise<Lemma> {
  const [row] = await db
    .select()
    .from(schema.lemmas)
    .where(eq(schema.lemmas.id, id))
    .limit(1);
  if (!row) throw new CuratorValidationError(`Lemma ${id} not found`, 404);
  return row as Lemma;
}

async function loadTranslation(id: string): Promise<Translation> {
  const [row] = await db
    .select()
    .from(schema.translations)
    .where(eq(schema.translations.id, id))
    .limit(1);
  if (!row) {
    throw new CuratorValidationError(`Translation ${id} not found`, 404);
  }
  return row as Translation;
}

/** Snapshot a lemma row for the audit diff. Dates are stringified so
 * the JSONB column round-trips cleanly. */
function snapshotLemma(row: Lemma): Record<string, unknown> {
  return {
    id: row.id,
    language: row.language,
    headword: row.headword,
    pos: row.pos,
    script: row.script,
    glossDefault: row.glossDefault,
    frequencyRank: row.frequencyRank,
    source: row.source,
    sourceAttribution: row.sourceAttribution,
    sourceId: row.sourceId,
    curatorLocked: row.curatorLocked,
  };
}

function snapshotTranslation(row: Translation): Record<string, unknown> {
  return {
    id: row.id,
    // T-14.7a: snapshot the polymorphic columns instead of the
    // legacy lemma_id. Audit-log payloads under
    // `lemma_edit_change_type='lemma_*'` will only ever carry
    // target_type='lemma' rows (the curator surface itself is
    // lemma-scoped), but recording target_type explicitly makes
    // the audit human-readable.
    targetType: row.targetType,
    targetId: row.targetId,
    source: row.source,
    submittedBy: row.submittedBy,
    parentTranslationId: row.parentTranslationId,
    body: row.body,
    targetLanguage: row.targetLanguage,
    sourceAttribution: row.sourceAttribution,
    sourceId: row.sourceId,
    hidden: row.hidden,
  };
}

function snapshotForm(row: LemmaForm): Record<string, unknown> {
  return {
    id: row.id,
    lemmaId: row.lemmaId,
    surface: row.surface,
    features: row.features,
    romanization: row.romanization,
  };
}

// -----------------------------------------------------------------------
// updateLemma
// -----------------------------------------------------------------------

export type UpdateLemmaPatch = {
  headword?: string;
  pos?: string;
  script?: string;
  glossDefault?: string | null;
  frequencyRank?: number | null;
  sourceAttribution?: string | null;
};

function normalizeHeadword(raw: string): string {
  return raw.normalize('NFC').trim();
}

function validateLemmaPatch(patch: UpdateLemmaPatch): void {
  if (patch.headword !== undefined) {
    const trimmed = normalizeHeadword(patch.headword);
    if (trimmed.length === 0) {
      throw new CuratorValidationError('headword cannot be empty');
    }
    if (trimmed.length > 128) {
      throw new CuratorValidationError('headword exceeds 128 characters');
    }
  }
  if (patch.pos !== undefined) {
    if (patch.pos.trim().length === 0) {
      throw new CuratorValidationError('pos cannot be empty');
    }
    if (patch.pos.length > 32) {
      throw new CuratorValidationError('pos exceeds 32 characters');
    }
  }
  if (patch.script !== undefined && !/^[A-Z][a-z]{3}$/.test(patch.script)) {
    throw new CuratorValidationError('script must be an ISO 15924 code');
  }
  if (
    patch.frequencyRank !== undefined &&
    patch.frequencyRank !== null &&
    (!Number.isInteger(patch.frequencyRank) || patch.frequencyRank < 0)
  ) {
    throw new CuratorValidationError('frequencyRank must be a non-negative integer');
  }
}

/**
 * Update editable fields on a lemma. Does NOT allow changing `language`
 * (which would orphan translations + forms); merges are the right tool
 * for that if the language was wrong originally.
 */
export async function updateLemma(
  editor: Editor,
  lemmaId: string,
  patch: UpdateLemmaPatch,
  reason: string,
  now: Date = new Date(),
): Promise<Lemma> {
  validateLemmaPatch(patch);
  const existing = await loadLemma(lemmaId);
  await requireCanEditDictionary(editor, existing.language);

  const setValues: Partial<Lemma> = { updatedAt: now };
  if (patch.headword !== undefined) setValues.headword = normalizeHeadword(patch.headword);
  if (patch.pos !== undefined) setValues.pos = patch.pos.trim();
  if (patch.script !== undefined) setValues.script = patch.script;
  if (patch.glossDefault !== undefined) setValues.glossDefault = patch.glossDefault;
  if (patch.frequencyRank !== undefined) setValues.frequencyRank = patch.frequencyRank;
  if (patch.sourceAttribution !== undefined) {
    setValues.sourceAttribution = patch.sourceAttribution;
  }
  // Any curator touch implicitly locks the row against future import
  // re-runs clobbering the edit.
  setValues.curatorLocked = true;

  const [updated] = await db
    .update(schema.lemmas)
    .set(setValues)
    .where(eq(schema.lemmas.id, lemmaId))
    .returning();
  if (!updated) throw new Error('Failed to update lemma');

  await recordLemmaEdit({
    lemmaId,
    editorId: editor.id,
    changeType: 'lemma_update',
    change: {
      before: snapshotLemma(existing),
      after: snapshotLemma(updated as Lemma),
    },
    reason,
  });
  return updated as Lemma;
}

// -----------------------------------------------------------------------
// setLemmaLock
// -----------------------------------------------------------------------

/**
 * Flip `curatorLocked`. Unlocking is explicit so a curator can accept a
 * fresh upstream import over their edit if they want to — otherwise
 * `updateLemma` keeps the row locked.
 */
export async function setLemmaLock(
  editor: Editor,
  lemmaId: string,
  locked: boolean,
  reason: string,
  now: Date = new Date(),
): Promise<Lemma> {
  const existing = await loadLemma(lemmaId);
  await requireCanEditDictionary(editor, existing.language);
  if (existing.curatorLocked === locked) return existing;

  const [updated] = await db
    .update(schema.lemmas)
    .set({ curatorLocked: locked, updatedAt: now })
    .where(eq(schema.lemmas.id, lemmaId))
    .returning();
  if (!updated) throw new Error('Failed to set lemma lock');

  await recordLemmaEdit({
    lemmaId,
    editorId: editor.id,
    changeType: locked ? 'lemma_lock' : 'lemma_unlock',
    change: {
      before: snapshotLemma(existing),
      after: snapshotLemma(updated as Lemma),
    },
    reason,
  });
  return updated as Lemma;
}

// -----------------------------------------------------------------------
// deleteLemma — destructive op behind the moderation Operations menu.
// -----------------------------------------------------------------------

/**
 * Delete a lemma row. Cascades through the FKs in the schema:
 *
 *   - `lemma_forms` (ON DELETE CASCADE) — every inflected form goes
 *   - `translations` where `target_id = lemmaId` AND `target_type = 'lemma'`
 *     (deleted explicitly below — the `target_id` column has no FK because
 *     it points at lemmas OR phrases)
 *   - `lemma_edit_history` (ON DELETE CASCADE) — audit rows die with
 *     the lemma. We accept that loss; preserving cross-cascade history
 *     would require a `phrase_id`-style nullable column on the audit
 *     row, which is more plumbing than this destructive-rare-op needs.
 *
 * No audit row is written for the delete itself — there's nothing to
 * point a `lemma_id` FK at by the time the row would land.
 */
export async function deleteLemma(
  editor: Editor,
  lemmaId: string,
): Promise<void> {
  const existing = await loadLemma(lemmaId);
  await requireCanEditDictionary(editor, existing.language);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.translations)
      .where(
        and(
          eq(schema.translations.targetType, 'lemma'),
          eq(schema.translations.targetId, lemmaId),
        ),
      );
    await tx.delete(schema.lemmas).where(eq(schema.lemmas.id, lemmaId));
  });
}

// -----------------------------------------------------------------------
// updateTranslation (curator edit)
// -----------------------------------------------------------------------

export type UpdateTranslationPatch = {
  body?: string;
  targetLanguage?: string;
  sourceAttribution?: string | null;
  /** Promote a community submission into an official curator translation.
   * Only forward transitions allowed: `user` → `curator`. Curator rows
   * stay curator; official imports cannot be demoted here. */
  promoteToCurator?: boolean;
};

const MAX_BODY_LEN = 500;

function normalizeBody(body: string): string {
  return body.trim().replace(/\s+/g, ' ');
}

function validateTranslationPatch(patch: UpdateTranslationPatch): void {
  if (patch.body !== undefined) {
    const body = normalizeBody(patch.body);
    if (body.length === 0) {
      throw new CuratorValidationError('body cannot be empty');
    }
    if (body.length > MAX_BODY_LEN) {
      throw new CuratorValidationError(`body exceeds ${MAX_BODY_LEN} characters`);
    }
  }
  if (
    patch.targetLanguage !== undefined &&
    !/^[a-z]{2,3}$/.test(patch.targetLanguage.toLowerCase())
  ) {
    throw new CuratorValidationError(
      'targetLanguage must be a 2- or 3-letter ISO code',
    );
  }
}

export async function updateTranslation(
  editor: Editor,
  translationId: string,
  patch: UpdateTranslationPatch,
  reason: string,
  now: Date = new Date(),
): Promise<Translation> {
  validateTranslationPatch(patch);
  const existing = await loadTranslation(translationId);
  // T-14.1: curator dictionary editor today only handles lemma-
  // target translations. Phrase-target moderation lands in T-14.7
  // (curator merge + moderation parity for M14).
  // T-14.7a: gate reads via the polymorphic columns; legacy
  // lemma_id is dropped.
  if (existing.targetType !== 'lemma') {
    throw new CuratorValidationError(
      'Phrase-target translations are managed via the phrase editor (T-14.4 / T-14.7)',
      409,
    );
  }
  const parentLemma = await loadLemma(existing.targetId);
  await requireCanEditDictionary(editor, parentLemma.language);

  if (patch.promoteToCurator && existing.source === 'official_dictionary') {
    throw new CuratorValidationError(
      'An imported official translation cannot be re-tagged as curator — edit it directly',
      409,
    );
  }

  const setValues: Partial<Translation> = { updatedAt: now };
  if (patch.body !== undefined) setValues.body = normalizeBody(patch.body);
  if (patch.targetLanguage !== undefined) {
    setValues.targetLanguage = patch.targetLanguage.toLowerCase();
  }
  if (patch.sourceAttribution !== undefined) {
    setValues.sourceAttribution = patch.sourceAttribution;
  }
  if (patch.promoteToCurator && existing.source === 'user') {
    setValues.source = 'curator';
  }

  const [updated] = await db
    .update(schema.translations)
    .set(setValues)
    .where(eq(schema.translations.id, translationId))
    .returning();
  if (!updated) throw new Error('Failed to update translation');

  await recordLemmaEdit({
    // T-14.7a: read via the polymorphic target. The earlier
    // type/target guard above ensures targetType==='lemma' so
    // targetId is the lemma id this audit row should reference.
    lemmaId: existing.targetId,
    editorId: editor.id,
    changeType: 'translation_update',
    change: {
      translationId,
      before: snapshotTranslation(existing),
      after: snapshotTranslation(updated as Translation),
    },
    reason,
  });
  return updated as Translation;
}

// -----------------------------------------------------------------------
// setTranslationHidden
// -----------------------------------------------------------------------

export async function setTranslationHidden(
  editor: Editor,
  translationId: string,
  hidden: boolean,
  reason: string,
  now: Date = new Date(),
): Promise<Translation> {
  const existing = await loadTranslation(translationId);
  // T-14.1: same guard as `updateTranslation` above. Phrase-target
  // moderation goes through T-14.7's curator surface.
  // T-14.7a: gate via the polymorphic columns; legacy lemma_id
  // is dropped.
  if (existing.targetType !== 'lemma') {
    throw new CuratorValidationError(
      'Phrase-target translations are managed via the phrase editor (T-14.4 / T-14.7)',
      409,
    );
  }
  const parentLemma = await loadLemma(existing.targetId);
  await requireCanEditDictionary(editor, parentLemma.language);

  if (existing.source !== 'user') {
    throw new CuratorValidationError(
      'Only community (source=user) translations can be hidden — edit officials directly',
      409,
    );
  }
  if (existing.hidden === hidden) return existing;

  const [updated] = await db
    .update(schema.translations)
    .set({ hidden, updatedAt: now })
    .where(eq(schema.translations.id, translationId))
    .returning();
  if (!updated) throw new Error('Failed to set hidden flag');

  await recordLemmaEdit({
    // T-14.7a: same pattern as updateTranslation above —
    // the lemma-target guard earlier in the function makes
    // targetId the lemma id this audit references.
    lemmaId: existing.targetId,
    editorId: editor.id,
    changeType: hidden ? 'translation_hide' : 'translation_unhide',
    change: {
      translationId,
      before: snapshotTranslation(existing),
      after: snapshotTranslation(updated as Translation),
    },
    reason,
  });
  return updated as Translation;
}

// -----------------------------------------------------------------------
// reorderTranslations (T-3.13)
// -----------------------------------------------------------------------

/**
 * Set the curator-controlled `display_rank` on every translation of a
 * lemma. Caller passes the canonical, complete order — the function
 * rejects partial orders so the UI can't accidentally orphan rows or
 * race with a concurrent insert. Rank N is assigned by index (0-based);
 * `bucketTranslations` honors it ahead of the existing tiebreakers.
 *
 * Audits a single `translation_reorder` row carrying before/after
 * snapshots of `(translationId, displayRank)` pairs so the history view
 * can render either side as a list.
 */
export async function reorderTranslations(
  editor: Editor,
  lemmaId: string,
  orderedTranslationIds: string[],
  reason: string,
  now: Date = new Date(),
): Promise<Translation[]> {
  if (orderedTranslationIds.length === 0) {
    throw new CuratorValidationError(
      'Reorder requires at least one translation id',
    );
  }
  const seen = new Set<string>();
  for (const id of orderedTranslationIds) {
    if (seen.has(id)) {
      throw new CuratorValidationError(
        `Duplicate translation id in order: ${id}`,
      );
    }
    seen.add(id);
  }

  const lemma = await loadLemma(lemmaId);
  await requireCanEditDictionary(editor, lemma.language);

  const existing = (await db
    .select()
    .from(schema.translations)
    .where(
      and(
        // T-14.7a: switched from `lemma_id` to the polymorphic
        // `(target_type, target_id)` so the legacy column can be
        // dropped. Phrase translations don't appear here anyway
        // (the curator translation reorder UI is lemma-only),
        // but the explicit type predicate is required now that
        // the row's `target_id` may also point at a phrase.
        eq(schema.translations.targetType, 'lemma'),
        eq(schema.translations.targetId, lemmaId),
      ),
    )) as Translation[];

  if (existing.length !== orderedTranslationIds.length) {
    throw new CuratorValidationError(
      'orderedTranslationIds must contain exactly the translations on this lemma — re-fetch and try again',
      409,
    );
  }
  const existingIds = new Set(existing.map((t) => t.id));
  for (const id of orderedTranslationIds) {
    if (!existingIds.has(id)) {
      throw new CuratorValidationError(
        `Translation ${id} does not belong to lemma ${lemmaId}`,
        404,
      );
    }
  }

  const before = existing.map((t) => ({
    translationId: t.id,
    displayRank: t.displayRank,
  }));

  // No transaction wrapper to match the existing merge/split pattern in
  // this file. A crash mid-loop leaves display_rank values arbitrary,
  // which a re-run corrects; there's no uniqueness constraint to violate.
  for (let i = 0; i < orderedTranslationIds.length; i += 1) {
    const id = orderedTranslationIds[i] as string;
    await db
      .update(schema.translations)
      .set({ displayRank: i, updatedAt: now })
      .where(eq(schema.translations.id, id));
  }

  const after = orderedTranslationIds.map((id, i) => ({
    translationId: id,
    displayRank: i,
  }));

  await recordLemmaEdit({
    lemmaId,
    editorId: editor.id,
    changeType: 'translation_reorder',
    change: {
      translationOrderBefore: before,
      translationOrderAfter: after,
    },
    reason,
  });

  // Return rows in the new order so the caller (form action / API) can
  // render the post-write state without a second select.
  const byId = new Map(existing.map((t) => [t.id, t]));
  return orderedTranslationIds.map((id, i) => {
    const row = byId.get(id) as Translation;
    return { ...row, displayRank: i, updatedAt: now };
  });
}

// -----------------------------------------------------------------------
// mergeLemmas
// -----------------------------------------------------------------------

export type MergeLemmasInput = {
  winnerId: string;
  loserId: string;
};

export type MergeLemmasResult = {
  winner: Lemma;
  translationsMoved: number;
  formsMoved: number;
};

/**
 * Rewire translations + forms from loser → winner, then delete the loser.
 *
 * Guards:
 *  - Same language (the two enum rows must match; merging across
 *    languages is a mistake, not a correction).
 *  - Winner and loser must be distinct rows.
 *  - Both must exist.
 *
 * Audits once per lemma in `lemma_edit_history`: the winner's row gets
 * a summary with the loser snapshot, and the loser's row gets the
 * same payload under its own `lemma_id` so the timeline is complete
 * from either side (the loser row remains referenceable by FK before
 * cascade removes its history on the final delete — so we write the
 * loser-side audit BEFORE the delete).
 */
export async function mergeLemmas(
  editor: Editor,
  input: MergeLemmasInput,
  reason: string,
): Promise<MergeLemmasResult> {
  if (input.winnerId === input.loserId) {
    throw new CuratorValidationError('Cannot merge a lemma into itself');
  }
  const winner = await loadLemma(input.winnerId);
  const loser = await loadLemma(input.loserId);
  if (winner.language !== loser.language) {
    throw new CuratorValidationError(
      'Cannot merge lemmas across languages',
      409,
    );
  }
  await requireCanEditDictionary(editor, winner.language);

  const loserTranslations = await db
    .select()
    .from(schema.translations)
    .where(
      and(
        // T-14.7a: switched to the polymorphic target_id. Phrase-
        // target rows wouldn't match a `lemmas.id` value, but the
        // explicit type predicate keeps the query plan honest.
        eq(schema.translations.targetType, 'lemma'),
        eq(schema.translations.targetId, loser.id),
      ),
    );

  const loserForms = await db
    .select()
    .from(schema.lemmaForms)
    .where(eq(schema.lemmaForms.lemmaId, loser.id));

  await db
    .update(schema.translations)
    // T-14.7a: reassign the polymorphic target_id; the legacy
    // lemma_id column is dropped in this PR's migration so we
    // no longer touch it.
    .set({ targetId: winner.id })
    .where(
      and(
        eq(schema.translations.targetType, 'lemma'),
        eq(schema.translations.targetId, loser.id),
      ),
    );

  await db
    .update(schema.lemmaForms)
    .set({ lemmaId: winner.id })
    .where(eq(schema.lemmaForms.lemmaId, loser.id));

  // Record the loser-side audit FIRST — cascading delete below would
  // otherwise remove the audit rows we just wrote for its lemma_id.
  // The history table's FK is `ON DELETE cascade` precisely so we don't
  // leak orphans, but it means loser-side audit has to pre-date the delete.
  await recordLemmaEdit({
    lemmaId: loser.id,
    editorId: editor.id,
    changeType: 'lemma_merge',
    change: {
      before: snapshotLemma(loser),
      after: snapshotLemma(winner),
      translationIds: (loserTranslations as Translation[]).map((t) => t.id),
      formIds: (loserForms as LemmaForm[]).map((f) => f.id),
      direction: 'loser',
    },
    reason,
  });

  await db.delete(schema.lemmas).where(eq(schema.lemmas.id, loser.id));

  await recordLemmaEdit({
    lemmaId: winner.id,
    editorId: editor.id,
    changeType: 'lemma_merge',
    change: {
      before: snapshotLemma(winner),
      after: snapshotLemma(winner),
      mergedFrom: snapshotLemma(loser),
      translationsMoved: (loserTranslations as Translation[]).map(snapshotTranslation),
      formsMoved: (loserForms as LemmaForm[]).map(snapshotForm),
      direction: 'winner',
    },
    reason,
  });

  return {
    winner,
    translationsMoved: (loserTranslations as Translation[]).length,
    formsMoved: (loserForms as LemmaForm[]).length,
  };
}

// -----------------------------------------------------------------------
// splitLemma
// -----------------------------------------------------------------------

export type SplitLemmaInput = {
  fromLemmaId: string;
  /** Fields of the newly created lemma. `language` and `script` are
   * inherited from the source unless overridden. */
  newLemma: {
    headword: string;
    pos: string;
    script?: string;
    glossDefault?: string | null;
    frequencyRank?: number | null;
    sourceAttribution?: string | null;
  };
  /** Translation ids to move off the source onto the new lemma. */
  translationIds?: string[];
  /** Lemma-form ids to move. */
  formIds?: string[];
};

export type SplitLemmaResult = {
  source: Lemma;
  created: Lemma;
  translationsMoved: number;
  formsMoved: number;
};

/**
 * Create a new lemma off an existing one, moving the selected
 * translations + forms. Useful when a single dictionary entry turns out
 * to conflate two genuine lemmas (common with homographs imported
 * without POS disambiguation).
 *
 * Guards against moving translations/forms that don't actually belong
 * to the source lemma — that would silently corrupt someone else's row.
 */
export async function splitLemma(
  editor: Editor,
  input: SplitLemmaInput,
  reason: string,
): Promise<SplitLemmaResult> {
  const source = await loadLemma(input.fromLemmaId);
  await requireCanEditDictionary(editor, source.language);

  const headword = normalizeHeadword(input.newLemma.headword ?? '');
  if (headword.length === 0) {
    throw new CuratorValidationError('new headword cannot be empty');
  }
  const pos = input.newLemma.pos?.trim() ?? '';
  if (pos.length === 0) {
    throw new CuratorValidationError('new pos cannot be empty');
  }
  const translationIds = input.translationIds ?? [];
  const formIds = input.formIds ?? [];

  if (translationIds.length === 0 && formIds.length === 0) {
    throw new CuratorValidationError(
      'Split requires at least one translation or form to move',
    );
  }

  if (translationIds.length > 0) {
    const rows = await db
      .select({
        id: schema.translations.id,
        // T-14.7a: read via the polymorphic columns. The split
        // path only operates on lemma-target rows; phrase
        // translations don't belong to a "source lemma" by
        // definition.
        targetType: schema.translations.targetType,
        targetId: schema.translations.targetId,
      })
      .from(schema.translations)
      .where(inArray(schema.translations.id, translationIds));
    if (rows.length !== translationIds.length) {
      throw new CuratorValidationError(
        'One or more translationIds do not exist',
        404,
      );
    }
    for (const row of rows) {
      if (row.targetType !== 'lemma' || row.targetId !== source.id) {
        throw new CuratorValidationError(
          `Translation ${row.id} does not belong to the source lemma`,
          409,
        );
      }
    }
  }
  if (formIds.length > 0) {
    const rows = await db
      .select({ id: schema.lemmaForms.id, lemmaId: schema.lemmaForms.lemmaId })
      .from(schema.lemmaForms)
      .where(inArray(schema.lemmaForms.id, formIds));
    if (rows.length !== formIds.length) {
      throw new CuratorValidationError(
        'One or more formIds do not exist',
        404,
      );
    }
    for (const row of rows) {
      if (row.lemmaId !== source.id) {
        throw new CuratorValidationError(
          `Form ${row.id} does not belong to the source lemma`,
          409,
        );
      }
    }
  }

  const [created] = await db
    .insert(schema.lemmas)
    .values({
      language: source.language,
      headword,
      pos,
      script: input.newLemma.script ?? source.script,
      glossDefault: input.newLemma.glossDefault ?? null,
      frequencyRank: input.newLemma.frequencyRank ?? null,
      // New lemmas born of a split are curator rows — they never came
      // from an upstream source.
      source: 'curator',
      sourceAttribution:
        input.newLemma.sourceAttribution ?? `Split from ${source.headword}`,
      sourceId: null,
      curatorLocked: true,
    })
    .returning();
  if (!created) throw new Error('Failed to create split lemma');

  if (translationIds.length > 0) {
    await db
      .update(schema.translations)
      // T-14.7a: assign only the polymorphic target_id —
      // legacy lemma_id is dropped in this PR's migration.
      .set({ targetId: (created as Lemma).id })
      .where(
        and(
          inArray(schema.translations.id, translationIds),
          eq(schema.translations.targetType, 'lemma'),
          eq(schema.translations.targetId, source.id),
        ),
      );
  }
  if (formIds.length > 0) {
    await db
      .update(schema.lemmaForms)
      .set({ lemmaId: (created as Lemma).id })
      .where(
        and(
          inArray(schema.lemmaForms.id, formIds),
          eq(schema.lemmaForms.lemmaId, source.id),
        ),
      );
  }

  await recordLemmaEdit({
    lemmaId: source.id,
    editorId: editor.id,
    changeType: 'lemma_split',
    change: {
      before: snapshotLemma(source),
      after: snapshotLemma(source),
      splitInto: snapshotLemma(created as Lemma),
      translationIds,
      formIds,
      direction: 'source',
    },
    reason,
  });
  await recordLemmaEdit({
    lemmaId: (created as Lemma).id,
    editorId: editor.id,
    changeType: 'lemma_split',
    change: {
      before: null,
      after: snapshotLemma(created as Lemma),
      splitFrom: snapshotLemma(source),
      translationIds,
      formIds,
      direction: 'created',
    },
    reason,
  });

  return {
    source,
    created: created as Lemma,
    translationsMoved: translationIds.length,
    formsMoved: formIds.length,
  };
}

// -----------------------------------------------------------------------
// Read helpers for the editor UI
// -----------------------------------------------------------------------

/**
 * Full lemma detail + all translations (including hidden) + forms +
 * recent audit history. Curator view — bypasses the reader's
 * hidden-translation filter.
 */
export async function getLemmaEditorView(
  editor: Editor,
  lemmaId: string,
): Promise<{
  lemma: Lemma;
  translations: Translation[];
  forms: LemmaForm[];
  history: Array<{
    id: string;
    changeType: string;
    reason: string;
    createdAt: Date;
    editorId: string | null;
  }>;
}> {
  const lemma = await loadLemma(lemmaId);
  await requireCanEditDictionary(editor, lemma.language);
  // Editor view sorts by curator-set rank ascending (Postgres default
  // is NULLS LAST for ASC, so unranked rows fall to the end), then by
  // createdAt for stability within ties. Reorder UI relies on this
  // canonical order matching what the reader will see (T-3.13).
  const translations = (await db
    .select()
    .from(schema.translations)
    .where(
      and(
        // T-14.7a: switched to (target_type, target_id) so the
        // editor view never accidentally surfaces a phrase-target
        // translation (curators edit phrase translations through
        // the phrase editor in T-14.4a).
        eq(schema.translations.targetType, 'lemma'),
        eq(schema.translations.targetId, lemmaId),
      ),
    )
    .orderBy(
      asc(schema.translations.displayRank),
      asc(schema.translations.createdAt),
    )) as Translation[];
  const forms = (await db
    .select()
    .from(schema.lemmaForms)
    .where(eq(schema.lemmaForms.lemmaId, lemmaId))) as LemmaForm[];
  const history = (await db
    .select({
      id: schema.lemmaEditHistory.id,
      changeType: schema.lemmaEditHistory.changeType,
      reason: schema.lemmaEditHistory.reason,
      createdAt: schema.lemmaEditHistory.createdAt,
      editorId: schema.lemmaEditHistory.editorId,
    })
    .from(schema.lemmaEditHistory)
    .where(eq(schema.lemmaEditHistory.lemmaId, lemmaId))) as Array<{
    id: string;
    changeType: string;
    reason: string;
    createdAt: Date;
    editorId: string | null;
  }>;
  return { lemma, translations, forms, history };
}
