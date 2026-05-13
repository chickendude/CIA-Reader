/**
 * Paradigm registry + form generator.
 *
 * A paradigm is a conjugation/declension pattern stored as a
 * `paradigms` row plus a list of `paradigm_slots` rows. A lemma opts
 * in by setting `lemmas.paradigm_id` and `lemmas.stem`. The generator
 * here turns (paradigm, stem) into the concrete surface forms that
 * land in `lemma_forms`.
 *
 * Sandhi: the Odia/Devanagari rendering pipeline already handles the
 * vowel-sign joins curators care about (`ର` + `ୁ` renders as ରୁ
 * because `ୁ` is a vowel sign, not a standalone vowel), so the
 * generator does plain string concatenation. If a future paradigm
 * needs true sandhi rules (consonant alternation, schwa deletion at
 * morpheme boundaries) the combine step is the right place to teach
 * — for now the seam is `combine(stem, suffix) = stem + suffix`.
 */
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';
import type { Lemma, Paradigm, ParadigmSlot } from '../db/schema.js';

export class ParadigmValidationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ParadigmValidationError';
    this.status = status;
  }
}

export type GeneratedForm = {
  /** Stable handle from the slot. Lets callers and tests address a
   *  generated form without round-tripping through its UUID. */
  slotKey: string;
  /** UUID of the originating slot. Persisted on the
   *  `lemma_forms.paradigm_slot_id` column so a paradigm edit's
   *  regenerate run can rebuild this row's surface in place. */
  paradigmSlotId: string;
  surface: string;
  features: Record<string, string>;
  sortOrder: number;
};

/**
 * Apply a paradigm's slots to a stem and return the surface forms.
 *
 * Pure function — no DB touch, no normalization beyond `stem.normalize('NFC')`
 * (so a curator who pastes a decomposed string still produces a
 * canonical surface). Caller is responsible for writing the rows.
 */
export function generateForms(
  slots: readonly ParadigmSlot[],
  stem: string,
): GeneratedForm[] {
  const stemNfc = stem.normalize('NFC');
  return slots.map((slot) => ({
    slotKey: slot.slotKey,
    paradigmSlotId: slot.id,
    surface: combine(stemNfc, slot.suffix).normalize('NFC'),
    features: slot.features,
    sortOrder: slot.sortOrder,
  }));
}

/**
 * Combine stem + suffix. Plain concatenation today; the hook is here
 * so per-language sandhi (e.g. Hindi schwa deletion at the stem-
 * suffix boundary) can land without rewriting `generateForms`.
 */
function combine(stem: string, suffix: string): string {
  return stem + suffix;
}

export async function loadParadigm(
  paradigmId: string,
): Promise<{ paradigm: Paradigm; slots: ParadigmSlot[] } | null> {
  const [paradigm] = await db
    .select()
    .from(schema.paradigms)
    .where(eq(schema.paradigms.id, paradigmId))
    .limit(1);
  if (!paradigm) return null;
  const slots = (await db
    .select()
    .from(schema.paradigmSlots)
    .where(eq(schema.paradigmSlots.paradigmId, paradigmId))
    .orderBy(asc(schema.paradigmSlots.sortOrder))) as ParadigmSlot[];
  return { paradigm: paradigm as Paradigm, slots };
}

/**
 * List paradigms eligible for a lemma's (language, pos). Used to
 * populate the form editor's paradigm picker — the curator should
 * only see options that match the lemma's POS, not Hindi noun
 * paradigms when editing an Odia verb.
 */
export async function listParadigmsForLemma(
  language: LanguageCode,
  pos: string,
): Promise<Paradigm[]> {
  return (await db
    .select()
    .from(schema.paradigms)
    .where(
      and(
        eq(schema.paradigms.language, language),
        eq(schema.paradigms.pos, pos),
      ),
    )
    .orderBy(asc(schema.paradigms.name))) as Paradigm[];
}

// ─── Curator-facing CRUD ─────────────────────────────────────────────
// The paradigm-editor admin page reads/writes through these helpers.
// All writes assume the caller has already proven admin via the
// route's load() / action guard — the helpers don't re-check the
// role, so callers must not expose them on a public-facing surface.

export type ParadigmListFilter = {
  language?: LanguageCode | null;
  pos?: string | null;
};

/**
 * List every paradigm, optionally narrowed by language and/or POS.
 * Ordered (language, pos, name) so the admin list groups naturally.
 */
export async function listParadigms(
  filter: ParadigmListFilter = {},
): Promise<Paradigm[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.language) conds.push(eq(schema.paradigms.language, filter.language));
  if (filter.pos && filter.pos.trim().length > 0) {
    conds.push(eq(schema.paradigms.pos, filter.pos.trim()));
  }
  const where = conds.length === 0 ? undefined : and(...conds);
  return (await db
    .select()
    .from(schema.paradigms)
    .where(where)
    .orderBy(
      asc(schema.paradigms.language),
      asc(schema.paradigms.pos),
      asc(schema.paradigms.name),
    )) as Paradigm[];
}

export type CreateParadigmInput = {
  language: string;
  pos: string;
  name: string;
  description?: string | null;
};

function validateParadigmCore(input: {
  language: string;
  pos: string;
  name: string;
}): { language: LanguageCode; pos: string; name: string } {
  const language = input.language.trim();
  const pos = input.pos.trim();
  const name = input.name.trim();
  if (!isSupportedLanguage(language)) {
    throw new ParadigmValidationError(`Unsupported language: ${input.language}`);
  }
  if (pos.length === 0) {
    throw new ParadigmValidationError('pos is required');
  }
  if (pos.length > 32) {
    throw new ParadigmValidationError('pos is too long (max 32 chars)');
  }
  if (name.length === 0) {
    throw new ParadigmValidationError('name is required');
  }
  if (name.length > 128) {
    throw new ParadigmValidationError('name is too long (max 128 chars)');
  }
  return { language: language as LanguageCode, pos, name };
}

export async function createParadigm(input: CreateParadigmInput): Promise<Paradigm> {
  const core = validateParadigmCore(input);
  const description =
    input.description == null || input.description.trim().length === 0
      ? null
      : input.description.trim();
  const [row] = await db
    .insert(schema.paradigms)
    .values({
      language: core.language,
      pos: core.pos,
      name: core.name,
      description,
    })
    .returning();
  if (!row) throw new ParadigmValidationError('Failed to create paradigm', 500);
  return row as Paradigm;
}

export type UpdateParadigmInput = {
  language?: string;
  pos?: string;
  name?: string;
  description?: string | null;
};

export async function updateParadigm(
  paradigmId: string,
  patch: UpdateParadigmInput,
): Promise<Paradigm> {
  const existing = await db
    .select()
    .from(schema.paradigms)
    .where(eq(schema.paradigms.id, paradigmId))
    .limit(1);
  const current = existing[0];
  if (!current) throw new ParadigmValidationError('Paradigm not found', 404);
  const next = {
    language: patch.language ?? current.language,
    pos: patch.pos ?? current.pos,
    name: patch.name ?? current.name,
  };
  const core = validateParadigmCore(next);
  const description =
    patch.description === undefined
      ? current.description
      : patch.description == null || patch.description.trim().length === 0
        ? null
        : patch.description.trim();
  const [row] = await db
    .update(schema.paradigms)
    .set({
      language: core.language,
      pos: core.pos,
      name: core.name,
      description,
      updatedAt: new Date(),
    })
    .where(eq(schema.paradigms.id, paradigmId))
    .returning();
  if (!row) throw new ParadigmValidationError('Paradigm not found', 404);
  return row as Paradigm;
}

/**
 * Delete a paradigm. Lemmas referencing it via `paradigm_id` are
 * untouched at the row level — the FK is `ON DELETE SET NULL`, so
 * affected lemmas keep their stem but lose the paradigm pointer.
 * Generator-created `lemma_forms` rows that still point at this
 * paradigm's slots will have their `paradigm_slot_id` set to NULL
 * via the cascading slot delete (slots are also SET NULL on the
 * forms side). Curators can clean up orphaned generator rows from
 * the per-lemma editor afterward.
 */
export async function deleteParadigm(paradigmId: string): Promise<void> {
  const [row] = await db
    .delete(schema.paradigms)
    .where(eq(schema.paradigms.id, paradigmId))
    .returning({ id: schema.paradigms.id });
  if (!row) throw new ParadigmValidationError('Paradigm not found', 404);
}

const SLOT_KEY_RE = /^[a-z0-9_]+$/;

function validateSlotCore(input: {
  slotKey: string;
  suffix: string;
  features: Record<string, string>;
  sortOrder: number;
}): {
  slotKey: string;
  suffix: string;
  features: Record<string, string>;
  sortOrder: number;
} {
  const slotKey = input.slotKey.trim();
  if (slotKey.length === 0) {
    throw new ParadigmValidationError('slot_key is required');
  }
  if (slotKey.length > 64) {
    throw new ParadigmValidationError('slot_key is too long (max 64 chars)');
  }
  if (!SLOT_KEY_RE.test(slotKey)) {
    throw new ParadigmValidationError(
      'slot_key must contain only lowercase letters, digits, and underscores',
    );
  }
  // Suffix may be empty — the seed has "pres_hab_2pl" with suffix ''.
  if (input.suffix.length > 64) {
    throw new ParadigmValidationError('suffix is too long (max 64 chars)');
  }
  for (const [k, v] of Object.entries(input.features)) {
    if (k.length === 0 || v.length === 0) {
      throw new ParadigmValidationError('features must have non-empty keys + values');
    }
  }
  if (!Number.isInteger(input.sortOrder)) {
    throw new ParadigmValidationError('sort_order must be an integer');
  }
  return {
    slotKey,
    suffix: input.suffix.normalize('NFC'),
    features: input.features,
    sortOrder: input.sortOrder,
  };
}

export type CreateSlotInput = {
  paradigmId: string;
  slotKey: string;
  features: Record<string, string>;
  suffix: string;
  sortOrder: number;
};

export async function createSlot(input: CreateSlotInput): Promise<ParadigmSlot> {
  const core = validateSlotCore(input);
  const [paradigm] = await db
    .select({ id: schema.paradigms.id })
    .from(schema.paradigms)
    .where(eq(schema.paradigms.id, input.paradigmId))
    .limit(1);
  if (!paradigm) throw new ParadigmValidationError('Paradigm not found', 404);
  try {
    const [row] = await db
      .insert(schema.paradigmSlots)
      .values({
        paradigmId: input.paradigmId,
        slotKey: core.slotKey,
        features: core.features,
        suffix: core.suffix,
        sortOrder: core.sortOrder,
      })
      .returning();
    if (!row) throw new ParadigmValidationError('Failed to create slot', 500);
    return row as ParadigmSlot;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ParadigmValidationError(
        `slot_key "${core.slotKey}" already exists in this paradigm`,
        409,
      );
    }
    throw e;
  }
}

export type UpdateSlotInput = {
  slotKey?: string;
  features?: Record<string, string>;
  suffix?: string;
  sortOrder?: number;
};

export async function updateSlot(
  slotId: string,
  patch: UpdateSlotInput,
): Promise<ParadigmSlot> {
  const [current] = await db
    .select()
    .from(schema.paradigmSlots)
    .where(eq(schema.paradigmSlots.id, slotId))
    .limit(1);
  if (!current) throw new ParadigmValidationError('Slot not found', 404);
  const core = validateSlotCore({
    slotKey: patch.slotKey ?? current.slotKey,
    suffix: patch.suffix ?? current.suffix,
    features: patch.features ?? current.features,
    sortOrder: patch.sortOrder ?? current.sortOrder,
  });
  try {
    const [row] = await db
      .update(schema.paradigmSlots)
      .set({
        slotKey: core.slotKey,
        features: core.features,
        suffix: core.suffix,
        sortOrder: core.sortOrder,
      })
      .where(eq(schema.paradigmSlots.id, slotId))
      .returning();
    if (!row) throw new ParadigmValidationError('Slot not found', 404);
    return row as ParadigmSlot;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ParadigmValidationError(
        `slot_key "${core.slotKey}" already exists in this paradigm`,
        409,
      );
    }
    throw e;
  }
}

export async function deleteSlot(slotId: string): Promise<void> {
  const [row] = await db
    .delete(schema.paradigmSlots)
    .where(eq(schema.paradigmSlots.id, slotId))
    .returning({ id: schema.paradigmSlots.id });
  if (!row) throw new ParadigmValidationError('Slot not found', 404);
}

/**
 * Rewrite the `sort_order` column for a list of slots. The caller
 * passes the canonical order — each slot's new position is its index
 * in the list times 10 (so future inline inserts have room without
 * a full re-ordering pass). All listed ids must belong to the same
 * paradigm.
 */
export async function reorderSlots(
  paradigmId: string,
  orderedSlotIds: string[],
): Promise<void> {
  if (orderedSlotIds.length === 0) return;
  const rows = await db
    .select({ id: schema.paradigmSlots.id, paradigmId: schema.paradigmSlots.paradigmId })
    .from(schema.paradigmSlots)
    .where(inArray(schema.paradigmSlots.id, orderedSlotIds));
  if (rows.length !== orderedSlotIds.length) {
    throw new ParadigmValidationError('One or more slot ids do not exist', 404);
  }
  for (const row of rows) {
    if (row.paradigmId !== paradigmId) {
      throw new ParadigmValidationError('Slot does not belong to this paradigm', 400);
    }
  }
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedSlotIds.entries()) {
      await tx
        .update(schema.paradigmSlots)
        .set({ sortOrder: (i + 1) * 10 })
        .where(eq(schema.paradigmSlots.id, id));
    }
  });
}

/**
 * Lemmas that opt into this paradigm and have a stem set — i.e. the
 * subset of consumers whose generated `lemma_forms` rows reflect the
 * current slot definitions. Lemmas without a stem aren't regenerated
 * (the form-generator no-ops on a null stem) so they're omitted here.
 *
 * Returned ordered by headword so the regen summary surface lists
 * them deterministically.
 */
export async function listLemmasUsingParadigm(
  paradigmId: string,
): Promise<Array<Pick<Lemma, 'id' | 'headword' | 'pos' | 'language' | 'stem'>>> {
  return (await db
    .select({
      id: schema.lemmas.id,
      headword: schema.lemmas.headword,
      pos: schema.lemmas.pos,
      language: schema.lemmas.language,
      stem: schema.lemmas.stem,
    })
    .from(schema.lemmas)
    .where(
      and(
        eq(schema.lemmas.paradigmId, paradigmId),
        isNotNull(schema.lemmas.stem),
      ),
    )
    .orderBy(asc(schema.lemmas.headword))) as Array<
    Pick<Lemma, 'id' | 'headword' | 'pos' | 'language' | 'stem'>
  >;
}

export async function countLemmasUsingParadigm(
  paradigmId: string,
): Promise<number> {
  // Reuses the list query to keep the "what counts" rule single-
  // sourced. The list is at most ~hundreds of rows in practice (one
  // paradigm covers a single language+pos cohort) so the extra
  // serialization cost over a SELECT count(*) is negligible.
  const rows = await listLemmasUsingParadigm(paradigmId);
  return rows.length;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: string }).code === '23505'
  );
}

/**
 * Bulk save the entire paradigm editor state in one transaction —
 * paradigm metadata, per-slot field edits, and slot order, applied
 * atomically. Drives the editor's single "Save changes" button.
 *
 * Slots are addressed by id; the caller passes every slot it knows
 * about IN THE ORDER they should appear, and the server derives
 * each slot's `sort_order` from its index in the payload (i.e.
 * `(i + 1) * 10` so future inline inserts have room). That makes the
 * drag-and-drop ordering in the UI the single source of truth — the
 * curator never sees or edits sort_order directly.
 *
 * We don't add or remove slots here — those still go through
 * `createSlot` / `deleteSlot` as immediate actions because they have
 * their own confirmation flows in the UI.
 */
export type SaveAllInput = {
  paradigm: {
    language: string;
    pos: string;
    name: string;
    description: string | null;
  };
  slots: Array<{
    id: string;
    slotKey: string;
    features: Record<string, string>;
    suffix: string;
  }>;
};

export async function saveAllParadigmChanges(
  paradigmId: string,
  input: SaveAllInput,
): Promise<void> {
  // Validate everything up-front so a bad slot doesn't half-apply.
  // The placeholder sortOrder fed into `validateSlotCore` is throwaway
  // — the real sortOrder gets stamped from the slot's array index in
  // the write below.
  const paradigmCore = validateParadigmCore(input.paradigm);
  const slotCores = input.slots.map((s, i) => ({
    id: s.id,
    ...validateSlotCore({
      slotKey: s.slotKey,
      suffix: s.suffix,
      features: s.features,
      sortOrder: (i + 1) * 10,
    }),
  }));
  const description =
    input.paradigm.description == null || input.paradigm.description.trim().length === 0
      ? null
      : input.paradigm.description.trim();

  await db.transaction(async (tx) => {
    const [pRow] = await tx
      .select({ id: schema.paradigms.id })
      .from(schema.paradigms)
      .where(eq(schema.paradigms.id, paradigmId))
      .limit(1);
    if (!pRow) throw new ParadigmValidationError('Paradigm not found', 404);

    if (slotCores.length > 0) {
      const ids = slotCores.map((s) => s.id);
      const existing = await tx
        .select({ id: schema.paradigmSlots.id, paradigmId: schema.paradigmSlots.paradigmId })
        .from(schema.paradigmSlots)
        .where(inArray(schema.paradigmSlots.id, ids));
      if (existing.length !== ids.length) {
        throw new ParadigmValidationError('One or more slot ids do not exist', 404);
      }
      for (const row of existing) {
        if (row.paradigmId !== paradigmId) {
          throw new ParadigmValidationError('Slot does not belong to this paradigm', 400);
        }
      }
    }

    await tx
      .update(schema.paradigms)
      .set({
        language: paradigmCore.language,
        pos: paradigmCore.pos,
        name: paradigmCore.name,
        description,
        updatedAt: new Date(),
      })
      .where(eq(schema.paradigms.id, paradigmId));

    // Single write per slot — fields + the position-derived sort_order
    // land together.
    for (const s of slotCores) {
      try {
        await tx
          .update(schema.paradigmSlots)
          .set({
            slotKey: s.slotKey,
            features: s.features,
            suffix: s.suffix,
            sortOrder: s.sortOrder,
          })
          .where(eq(schema.paradigmSlots.id, s.id));
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new ParadigmValidationError(
            `slot_key "${s.slotKey}" already exists in this paradigm`,
            409,
          );
        }
        throw e;
      }
    }
  });
}
