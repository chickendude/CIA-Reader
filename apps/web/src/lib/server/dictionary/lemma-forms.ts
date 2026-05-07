/**
 * Lemma-form repository + form-editor service layer.
 *
 * Backs the form-editor section on the curator's lemma page (T-3.7
 * extension). The shapes here are deliberately narrow — a curator
 * can:
 *
 *   - list the forms attached to a lemma (with their grammar pills)
 *   - add a new form by hand
 *   - edit an existing form's surface / features / romanization
 *   - delete a form
 *   - search across `lemma_forms.surface` to find which lemma a
 *     surface belongs to (the type-ahead in the form editor)
 *   - assign / remove a paradigm + stem
 *   - regenerate forms from the assigned paradigm
 *
 * Regenerate semantics: drop every `created_by != 'curator'` row for
 * the lemma, then insert one new `created_by='generator'` row per
 * paradigm slot. Curator-edited rows survive a regenerate, which is
 * what makes the editor safe to use repeatedly. Quarantined rows
 * also survive (they're already excluded from lookup); a follow-up
 * cleanup pass deals with them.
 *
 * All writes accept a Drizzle transaction handle so callers in
 * `curator.ts` can compose them with audit-row inserts.
 */
import { and, asc, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { nlpClient } from '../nlp-client.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { Lemma, LemmaForm, ParadigmSlot } from '../db/schema.js';

import { generateForms, loadParadigm } from './paradigms.js';

export type DbLike = typeof db;

export type LemmaFormRow = {
  id: string;
  surface: string;
  features: Record<string, string>;
  romanization: string | null;
  createdBy: LemmaForm['createdBy'];
  paradigmSlotId: string | null;
  paradigmSlotKey: string | null;
  quarantinedAt: Date | null;
  quarantineReason: string | null;
};

/**
 * List a lemma's forms in display order. Quarantined rows are
 * surfaced because the editor needs to expose them so the curator
 * can salvage the row — but they're sorted last so the live forms
 * land at the top.
 */
export async function listFormsForLemma(
  lemmaId: string,
  dbHandle: DbLike = db,
): Promise<LemmaFormRow[]> {
  const rows = await dbHandle
    .select({
      id: schema.lemmaForms.id,
      surface: schema.lemmaForms.surface,
      features: schema.lemmaForms.features,
      romanization: schema.lemmaForms.romanization,
      createdBy: schema.lemmaForms.createdBy,
      paradigmSlotId: schema.lemmaForms.paradigmSlotId,
      paradigmSlotKey: schema.paradigmSlots.slotKey,
      paradigmSlotSort: schema.paradigmSlots.sortOrder,
      quarantinedAt: schema.lemmaForms.quarantinedAt,
      quarantineReason: schema.lemmaForms.quarantineReason,
    })
    .from(schema.lemmaForms)
    .leftJoin(
      schema.paradigmSlots,
      eq(schema.paradigmSlots.id, schema.lemmaForms.paradigmSlotId),
    )
    .where(eq(schema.lemmaForms.lemmaId, lemmaId))
    // Sort: live rows first, then by slot sort_order (NULLs last so
    // curator-added forms with no paradigm slot don't shuffle ahead
    // of generator rows), then by surface for determinism.
    .orderBy(
      sql`${schema.lemmaForms.quarantinedAt} IS NOT NULL`,
      sql`${schema.paradigmSlots.sortOrder} NULLS LAST`,
      asc(schema.lemmaForms.surface),
    );
  return rows.map((r) => ({
    id: r.id,
    surface: r.surface,
    features: r.features,
    romanization: r.romanization,
    createdBy: r.createdBy,
    paradigmSlotId: r.paradigmSlotId,
    paradigmSlotKey: r.paradigmSlotKey,
    quarantinedAt: r.quarantinedAt,
    quarantineReason: r.quarantineReason,
  }));
}

export type CreateFormInput = {
  lemmaId: string;
  surface: string;
  features?: Record<string, string>;
  romanization?: string | null;
  createdBy?: LemmaForm['createdBy'];
};

export async function createForm(
  input: CreateFormInput,
  dbHandle: DbLike = db,
): Promise<LemmaForm> {
  const [row] = (await dbHandle
    .insert(schema.lemmaForms)
    .values({
      lemmaId: input.lemmaId,
      surface: input.surface.normalize('NFC'),
      features: input.features ?? {},
      romanization: input.romanization ?? null,
      createdBy: input.createdBy ?? 'curator',
    })
    .returning()) as LemmaForm[];
  return row!;
}

export type UpdateFormInput = {
  surface?: string;
  features?: Record<string, string>;
  romanization?: string | null;
  /** Pass `null` (or omit) to keep the existing reason. Pass a
   *  literal `null` plus `quarantinedAt: null` to un-quarantine. */
  quarantinedAt?: Date | null;
  quarantineReason?: string | null;
};

/**
 * Curator edit. Promotes the row's `created_by` to `'curator'` so
 * the next regenerate doesn't wipe it.
 */
export async function updateForm(
  formId: string,
  input: UpdateFormInput,
  dbHandle: DbLike = db,
): Promise<LemmaForm | null> {
  const patch: Partial<LemmaForm> = { createdBy: 'curator' };
  if (input.surface !== undefined) patch.surface = input.surface.normalize('NFC');
  if (input.features !== undefined) patch.features = input.features;
  if (input.romanization !== undefined) patch.romanization = input.romanization;
  if (input.quarantinedAt !== undefined) patch.quarantinedAt = input.quarantinedAt;
  if (input.quarantineReason !== undefined) patch.quarantineReason = input.quarantineReason;

  const [row] = (await dbHandle
    .update(schema.lemmaForms)
    .set(patch)
    .where(eq(schema.lemmaForms.id, formId))
    .returning()) as LemmaForm[];
  return row ?? null;
}

export async function deleteForm(
  formId: string,
  dbHandle: DbLike = db,
): Promise<void> {
  await dbHandle.delete(schema.lemmaForms).where(eq(schema.lemmaForms.id, formId));
}

/**
 * Type-ahead search across surfaces. Returns lemmas whose forms or
 * own headword match the query. Quarantined forms are excluded so
 * a curator's search doesn't surface junk.
 *
 * The query is a prefix match on either the form's `surface` or the
 * lemma's `headword` — UI-side this lets the curator type "rahil"
 * and find ରହିଲି, ରହିଲା, etc. all rolled up under their parent
 * lemma `ରହିବା`.
 */
export type FormSearchHit = {
  lemmaId: string;
  headword: string;
  pos: string;
  language: LanguageCode;
  /** The surface that matched; `null` when only the headword matched. */
  matchedSurface: string | null;
};

export async function searchFormsByPrefix(
  language: LanguageCode,
  query: string,
  opts: { limit?: number } = {},
  dbHandle: DbLike = db,
): Promise<FormSearchHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = `${trimmed.normalize('NFC')}%`;

  // Two unioned legs: one matches `lemma_forms.surface`, the other
  // matches `lemmas.headword`. We can't use Drizzle's `union` cleanly
  // because the headword leg has no `matchedSurface`; raw SQL keeps
  // the shape obvious and indexable.
  const rows = await dbHandle.execute<{
    lemma_id: string;
    headword: string;
    pos: string;
    language: LanguageCode;
    matched_surface: string | null;
  }>(sql`
    WITH form_hits AS (
      SELECT lf.lemma_id, l.headword, l.pos, l.language, lf.surface AS matched_surface
      FROM lemma_forms lf
      JOIN lemmas l ON l.id = lf.lemma_id
      WHERE l.language = ${language}
        AND lf.quarantined_at IS NULL
        AND lf.surface ILIKE ${pattern}
      LIMIT ${limit}
    ),
    headword_hits AS (
      SELECT id AS lemma_id, headword, pos, language, NULL::text AS matched_surface
      FROM lemmas
      WHERE language = ${language}
        AND headword ILIKE ${pattern}
      LIMIT ${limit}
    )
    SELECT * FROM form_hits
    UNION ALL
    SELECT * FROM headword_hits
    LIMIT ${limit}
  `);
  // pg returns `rows` shaped per the query; Drizzle typings here are
  // permissive — coerce to the public hit shape.
  type RawRow = {
    lemma_id: string;
    headword: string;
    pos: string;
    language: LanguageCode;
    matched_surface: string | null;
  };
  const list = (rows as unknown as { rows: RawRow[] }).rows ?? (rows as unknown as RawRow[]);
  return list.map((r) => ({
    lemmaId: r.lemma_id,
    headword: r.headword,
    pos: r.pos,
    language: r.language,
    matchedSurface: r.matched_surface,
  }));
}

/**
 * Set / clear a lemma's paradigm assignment.
 *
 * Doesn't regenerate forms — the editor calls `regenerateForms`
 * separately so the curator can stage the change before applying.
 */
export async function setLemmaParadigm(
  lemmaId: string,
  input: { paradigmId: string | null; stem: string | null },
  dbHandle: DbLike = db,
): Promise<Lemma | null> {
  const [row] = (await dbHandle
    .update(schema.lemmas)
    .set({
      paradigmId: input.paradigmId,
      stem: input.stem,
      updatedAt: new Date(),
    })
    .where(eq(schema.lemmas.id, lemmaId))
    .returning()) as Lemma[];
  return row ?? null;
}

export type RegenerateResult = {
  removed: number;
  inserted: number;
};

/**
 * Regenerate `lemma_forms` for a lemma from its assigned paradigm.
 *
 *  1. Fetch the lemma + its paradigm (404 / no-op if either missing
 *     or `stem` is null).
 *  2. Delete every form whose `created_by != 'curator'` (i.e.
 *     generator + import + pipeline rows). Quarantined rows go too —
 *     they're junk by definition; if the same surface re-appears
 *     from the paradigm it lands fresh and live.
 *  3. Insert one row per slot, with `created_by='generator'` and
 *     `paradigm_slot_id` linking back so the next regenerate can
 *     rebuild in place.
 *
 * The whole thing runs in a transaction so a partial failure
 * doesn't leave the lemma with a half-deleted form list.
 */
export async function regenerateForms(
  lemmaId: string,
): Promise<RegenerateResult> {
  return await db.transaction(async (tx) => {
    const [lemma] = (await tx
      .select()
      .from(schema.lemmas)
      .where(eq(schema.lemmas.id, lemmaId))
      .limit(1)) as Lemma[];
    if (!lemma) throw new Error(`Lemma not found: ${lemmaId}`);
    if (!lemma.paradigmId || !lemma.stem) {
      // Nothing to regenerate from — caller should have validated.
      return { removed: 0, inserted: 0 };
    }
    const loaded = await loadParadigm(lemma.paradigmId);
    if (!loaded) throw new Error(`Paradigm not found: ${lemma.paradigmId}`);

    const deleted = await tx
      .delete(schema.lemmaForms)
      .where(
        and(
          eq(schema.lemmaForms.lemmaId, lemmaId),
          ne(schema.lemmaForms.createdBy, 'curator'),
        ),
      )
      .returning({ id: schema.lemmaForms.id });
    const removed = deleted.length;

    const generated = generateForms(loaded.slots, lemma.stem);
    // Pre-fill `romanization` for each generated surface by batching
    // a single call to the NLP service's /romanize endpoint. We use
    // the language's default scheme + script (same path the reader
    // takes for token romanizations) so paradigm output matches what
    // the user sees in chapters. Failures degrade gracefully: if the
    // service is down or rejects the batch, every row lands with
    // null romanization and the editor still works — the curator
    // can fill it in by hand later.
    let romanizations: Array<string | null> = generated.map(() => null);
    if (generated.length > 0) {
      try {
        const res = await nlpClient.romanize(
          lemma.language,
          generated.map((g) => g.surface),
        );
        if (Array.isArray(res.romanizations) && res.romanizations.length === generated.length) {
          romanizations = res.romanizations;
        }
      } catch {
        // Swallow — see comment above. A failed romanization batch
        // shouldn't block the regenerate from finishing.
      }
    }
    if (generated.length > 0) {
      await tx.insert(schema.lemmaForms).values(
        generated.map((g, i) => ({
          lemmaId,
          surface: g.surface,
          features: g.features,
          romanization: romanizations[i] ?? null,
          createdBy: 'generator' as const,
          paradigmSlotId: g.paradigmSlotId,
        })),
      );
    }
    return { removed, inserted: generated.length };
  });
}

/**
 * Helper for the dispatcher's preload: every live (non-quarantined)
 * `(language, surface)` → `lemma_id` mapping. Returns the first row
 * per surface — `lemma_forms_surface_lookup_idx` is unique-enough in
 * practice (most surfaces map to one lemma); collisions are resolved
 * by the existing `form_lemma_overrides` mechanism the dispatcher
 * already consults.
 *
 * Filtered by language so the dispatcher only loads what it needs
 * for the chapter being processed.
 */
export async function loadSurfaceToLemmaMap(
  language: LanguageCode,
  dbHandle: DbLike = db,
): Promise<Map<string, string>> {
  const rows = await dbHandle
    .select({
      surface: schema.lemmaForms.surface,
      lemmaId: schema.lemmaForms.lemmaId,
    })
    .from(schema.lemmaForms)
    .innerJoin(schema.lemmas, eq(schema.lemmas.id, schema.lemmaForms.lemmaId))
    .where(
      and(
        eq(schema.lemmas.language, language),
        isNull(schema.lemmaForms.quarantinedAt),
      ),
    );
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!map.has(r.surface)) map.set(r.surface, r.lemmaId);
  }
  return map;
}

// Re-export for the dispatcher (which uses it as a single import
// surface alongside the existing `LemmaIndex` helpers).
export { type LemmaForm } from '../db/schema.js';

// Drizzle helpers used by callers in `curator.ts`.
export { or, ilike, desc };
