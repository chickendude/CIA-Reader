/**
 * Admin paradigm detail editor (curator-paradigm follow-up).
 *
 * One paradigm + its slots on a single page. The slots are addressable
 * by stable handle (`slot_key`) so a future migration / test can refer
 * to them without round-tripping through a UUID — same convention as
 * the seed SQL the page replaces.
 *
 * Features are entered as a comma-separated `Key=Value` list, mirroring
 * the parser the lemma form editor already ships (`Tense=Past, Person=1`).
 * Reusing the wire shape means a curator who's already learned to edit
 * a form's features doesn't have to learn a second syntax for slots.
 *
 * The editor uses three immediate actions — `addSlot`, `removeSlot`,
 * `deleteParadigm` — each gated by an inline confirmation in the UI.
 * Every other edit (paradigm metadata, per-slot field changes, slot
 * reorder) is staged client-side and shipped atomically by the
 * `saveAll` action so a curator's "Save changes" press is one
 * transaction, not five.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

import {
  ParadigmValidationError,
  countLemmasUsingParadigm,
  createSlot,
  deleteParadigm,
  deleteSlot,
  loadParadigm,
  saveAllParadigmChanges,
} from '$lib/server/dictionary/paradigms.js';
import { regenerateAllForParadigm } from '$lib/server/dictionary/lemma-forms.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { LANGUAGES, isSupportedLanguage } from '@ciareader/shared-types';
import type { Actions, PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapError(e: unknown): { status: number; message: string } {
  if (e instanceof ParadigmValidationError) {
    return { status: e.status, message: e.message };
  }
  return { status: 500, message: 'Unexpected error' };
}

type SaveAllResult =
  | {
      ok: true;
      section: 'saveAll';
      /** Number of lemmas opted into this paradigm with a stem set —
       *  the cohort whose generated forms may now be stale and that
       *  the UI should prompt to regenerate. Zero means the prompt
       *  is suppressed. */
      affectedLemmaCount: number;
    }
  | { ok: false; section: 'saveAll'; message: string };
type SlotFormResult =
  | { ok: true; section: 'slot'; action: 'add' | 'remove' }
  | {
      ok: false;
      section: 'slot';
      action: 'add' | 'remove';
      message: string;
    };
type RegenerateResult =
  | {
      ok: true;
      section: 'regenerate';
      lemmasProcessed: number;
      lemmasFailed: number;
      removed: number;
      inserted: number;
      failures: Array<{ lemmaId: string; headword: string; error: string }>;
    }
  | { ok: false; section: 'regenerate'; message: string };
type DeleteParadigmResult = { ok: false; section: 'delete'; message: string };

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  if (!isAdmin({ role: locals.user.role })) {
    throw error(403, 'Paradigm editor requires admin role');
  }
  if (!UUID_RE.test(params.id)) throw error(400, 'Invalid paradigm id');

  const loaded = await loadParadigm(params.id);
  if (!loaded) throw error(404, 'Paradigm not found');

  return {
    paradigm: loaded.paradigm,
    slots: loaded.slots,
    languages: Object.values(LANGUAGES).map((d) => ({
      code: d.code,
      displayName: d.displayName,
      nativeName: d.nativeName,
    })),
  };
};

/**
 * `Tense=Past, Person=1, Number=Sing` → { Tense: 'Past', Person: '1', Number: 'Sing' }.
 * Same shape the form-editor uses (`parseFeatureString` in dictionary/[id]/+page.server.ts).
 * Duplicated rather than imported because both pages will probably evolve
 * their feature-validation independently — the dictionary editor accepts
 * unknown keys silently, this page is admin-only and may want stricter
 * checks later.
 */
const FEAT_SEP = /\s*,\s*/;
function parseFeatureString(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const piece of raw.split(FEAT_SEP)) {
    if (!piece) continue;
    const eq = piece.indexOf('=');
    if (eq <= 0) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

const slotCreateSchema = z.object({
  slotKey: z.string().min(1).max(64),
  features: z.string().max(1024).optional().default(''),
  suffix: z.string().max(64).optional().default(''),
  sortOrder: z
    .string()
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? Number.parseInt(s, 10) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), {
      message: 'sortOrder must be a non-negative integer',
    }),
});

const slotDeleteSchema = z.object({
  slotId: z.string().regex(UUID_RE),
});

/**
 * Wire schema for `?/saveAll`. The Svelte side stringifies the editor's
 * client-side state into a single `payload` form field, server-side we
 * parse + validate it as JSON before handing the structured object to
 * the service. The features for each slot arrive as a key-value object
 * (already parsed in the browser) rather than a comma-separated string
 * — the service rejects empty keys / values either way.
 */
const saveAllSchema = z.object({
  paradigm: z.object({
    language: z.string().min(1).refine((v) => isSupportedLanguage(v), {
      message: 'unsupported language',
    }),
    pos: z.string().min(1).max(32),
    name: z.string().min(1).max(128),
    description: z
      .string()
      .max(1000)
      .nullable()
      .optional()
      .transform((s) => (s == null || s.trim().length === 0 ? null : s)),
  }),
  // `sortOrder` is intentionally NOT accepted from the client — the
  // server derives it from each slot's index in this array. That makes
  // the drag-and-drop order the single source of truth and forecloses
  // the "what if the curator's typed sort_order conflicts with their
  // drag order?" question.
  slots: z.array(
    z.object({
      id: z.string().regex(UUID_RE),
      slotKey: z.string().min(1).max(64),
      features: z.record(z.string(), z.string()),
      suffix: z.string().max(64),
    }),
  ),
});

export const actions: Actions = {
  saveAll: async ({ params, request, locals }) => {
    if (!locals.user || !isAdmin({ role: locals.user.role })) {
      return fail(403, {
        ok: false,
        section: 'saveAll',
        message: 'Admin role required',
      } satisfies SaveAllResult);
    }
    const form = await request.formData();
    const rawPayload = form.get('payload');
    if (typeof rawPayload !== 'string') {
      return fail(400, {
        ok: false,
        section: 'saveAll',
        message: 'Missing payload',
      } satisfies SaveAllResult);
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawPayload);
    } catch {
      return fail(400, {
        ok: false,
        section: 'saveAll',
        message: 'Malformed JSON payload',
      } satisfies SaveAllResult);
    }
    const parsed = saveAllSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'saveAll',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      } satisfies SaveAllResult);
    }
    try {
      await saveAllParadigmChanges(params.id, parsed.data);
      // Hand the UI the count of lemmas opted into this paradigm so
      // it can offer to regenerate their `lemma_forms` rows — slot
      // edits change the surfaces the generator would emit, so the
      // generator-created rows on those lemmas are now stale.
      const affectedLemmaCount = await countLemmasUsingParadigm(params.id);
      return {
        ok: true,
        section: 'saveAll',
        affectedLemmaCount,
      } satisfies SaveAllResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'saveAll',
        message: mapped.message,
      } satisfies SaveAllResult);
    }
  },

  /**
   * Walk every lemma opted into this paradigm and rebuild its
   * generator-created forms. Returns a summary the UI surfaces in a
   * banner so the curator sees what just happened. Per-lemma errors
   * don't abort the run; they're collected and reported.
   */
  regenerateAffected: async ({ params, locals }) => {
    if (!locals.user || !isAdmin({ role: locals.user.role })) {
      return fail(403, {
        ok: false,
        section: 'regenerate',
        message: 'Admin role required',
      } satisfies RegenerateResult);
    }
    try {
      const summary = await regenerateAllForParadigm(params.id);
      return {
        ok: true,
        section: 'regenerate',
        ...summary,
      } satisfies RegenerateResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'regenerate',
        message: mapped.message,
      } satisfies RegenerateResult);
    }
  },

  deleteParadigm: async ({ params, locals }) => {
    if (!locals.user || !isAdmin({ role: locals.user.role })) {
      return fail(403, {
        ok: false,
        section: 'delete',
        message: 'Admin role required',
      } satisfies DeleteParadigmResult);
    }
    try {
      await deleteParadigm(params.id);
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'delete',
        message: mapped.message,
      } satisfies DeleteParadigmResult);
    }
    throw redirect(303, '/moderation/paradigms');
  },

  addSlot: async ({ params, request, locals }) => {
    if (!locals.user || !isAdmin({ role: locals.user.role })) {
      return fail(403, {
        ok: false,
        section: 'slot',
        action: 'add',
        message: 'Admin role required',
      } satisfies SlotFormResult);
    }
    const form = Object.fromEntries(await request.formData());
    const parsed = slotCreateSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'slot',
        action: 'add',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      } satisfies SlotFormResult);
    }
    // Default sort order: append to the end. Re-read the slot list so
    // we can compute (max + 10); using the in-loader value would race
    // with concurrent adds.
    const existing = await loadParadigm(params.id);
    if (!existing) {
      return fail(404, {
        ok: false,
        section: 'slot',
        action: 'add',
        message: 'Paradigm not found',
      } satisfies SlotFormResult);
    }
    const maxSort = existing.slots.reduce((m, s) => Math.max(m, s.sortOrder), 0);
    const sortOrder = parsed.data.sortOrder ?? maxSort + 10;
    try {
      await createSlot({
        paradigmId: params.id,
        slotKey: parsed.data.slotKey,
        features: parseFeatureString(parsed.data.features),
        suffix: parsed.data.suffix,
        sortOrder,
      });
      return { ok: true, section: 'slot', action: 'add' } satisfies SlotFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'slot',
        action: 'add',
        message: mapped.message,
      } satisfies SlotFormResult);
    }
  },

  removeSlot: async ({ request, locals }) => {
    if (!locals.user || !isAdmin({ role: locals.user.role })) {
      return fail(403, {
        ok: false,
        section: 'slot',
        action: 'remove',
        message: 'Admin role required',
      } satisfies SlotFormResult);
    }
    const form = Object.fromEntries(await request.formData());
    const parsed = slotDeleteSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'slot',
        action: 'remove',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      } satisfies SlotFormResult);
    }
    try {
      await deleteSlot(parsed.data.slotId);
      return { ok: true, section: 'slot', action: 'remove' } satisfies SlotFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'slot',
        action: 'remove',
        message: mapped.message,
      } satisfies SlotFormResult);
    }
  },
};
