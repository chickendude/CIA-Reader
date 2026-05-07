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
import { and, asc, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { Paradigm, ParadigmSlot } from '../db/schema.js';

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
