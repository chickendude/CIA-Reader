/**
 * Curator lemma editor (T-3.7).
 *
 * SSR loader renders the full editor view (lemma fields, translations,
 * forms, recent history). Form actions route every mutation through the
 * same service layer the JSON API uses, so the validation + audit rules
 * are identical between web form and programmatic client.
 *
 * Sub-forms (edit / hide / merge / split / promote / lock) each post to
 * a distinct action name and return a discriminated `section`-tagged
 * result so the template can render inline success / error messages
 * next to the right form without juggling union narrowing in the UI.
 *
 * Script-aware inputs (T-6.2a) aren't in the codebase yet; for now the
 * form uses plain text inputs and curators paste the native-script
 * headword directly. The service already NFC-normalises on write.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

import {
  CuratorValidationError,
  deleteLemma,
  getLemmaEditorView,
  mergeLemmas,
  reorderTranslations,
  setLemmaLock,
  setTranslationHidden,
  splitLemma,
  updateLemma,
  updateTranslation,
} from '$lib/server/dictionary/curator.js';
import {
  createForm,
  deleteForm,
  listFormsForLemma,
  regenerateForms,
  setLemmaParadigm,
  updateForm,
} from '$lib/server/dictionary/lemma-forms.js';
import { listParadigmsForLemma } from '$lib/server/dictionary/paradigms.js';
import { deriveProvenance } from '$lib/server/dictionary/lookups.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import { ForbiddenError, isAdmin } from '$lib/server/dictionary/permissions.js';
import type { Actions, PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapError(e: unknown): { status: number; message: string } {
  if (e instanceof CuratorValidationError) {
    return { status: e.status, message: e.message };
  }
  if (e instanceof MissingReasonError) {
    return { status: 400, message: e.message };
  }
  if (e instanceof ForbiddenError) {
    return { status: 403, message: e.message };
  }
  return { status: 500, message: 'Unexpected error' };
}

type LemmaFormResult =
  | { ok: true; section: 'lemma' }
  | { ok: false; section: 'lemma'; message: string };
type LockFormResult =
  | { ok: true; section: 'lock' }
  | { ok: false; section: 'lock'; message: string };
type TranslationFormResult =
  | { ok: true; section: 'translation'; translationId: string }
  | { ok: false; section: 'translation'; translationId: string | null; message: string };
type MergeFormResult =
  | { ok: true; section: 'merge' }
  | { ok: false; section: 'merge'; message: string };
type SplitFormResult =
  | { ok: true; section: 'split'; newLemmaId: string }
  | { ok: false; section: 'split'; message: string };
type ReorderFormResult =
  | { ok: true; section: 'reorder' }
  | { ok: false; section: 'reorder'; message: string };
type FormSectionResult =
  | { ok: true; section: 'form'; action: string }
  | { ok: false; section: 'form'; action: string; message: string };
type ParadigmSectionResult =
  | { ok: true; section: 'paradigm'; action: 'set' | 'regenerate' }
  | { ok: false; section: 'paradigm'; action: 'set' | 'regenerate'; message: string };
type DeleteResult =
  | { ok: false; section: 'delete'; message: string };
// Per-field inline edit on the lemma identity row. The action returns the
// same `lemma` section as the bulk update so the page's flash logic can
// reuse the existing message handler.
type FieldPatchResult =
  | { ok: true; section: 'lemma'; field: string }
  | { ok: false; section: 'lemma'; field: string; message: string };

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  if (!UUID_RE.test(params.id)) throw error(400, 'Invalid lemma id');
  try {
    const view = await getLemmaEditorView(
      { id: locals.user.id, role: locals.user.role },
      params.id,
    );
    // Attach the same provenance discriminator the public translation
    // endpoint exposes (T-3.8) so the editor renders the same badge as
    // the reader pop-up will.
    const editorViewer = { id: locals.user.id };
    // Pull the forms list + paradigm catalog in parallel; both are
    // small reads and the section needs them on first render.
    const [forms, availableParadigms] = await Promise.all([
      listFormsForLemma(view.lemma.id),
      listParadigmsForLemma(view.lemma.language, view.lemma.pos),
    ]);
    return {
      ...view,
      translations: view.translations.map((t) => ({
        ...t,
        provenance: deriveProvenance(t, editorViewer),
      })),
      forms,
      availableParadigms,
    };
  } catch (e) {
    const mapped = mapError(e);
    if (mapped.status === 500) {
      // mapError() collapses unknown errors to "Unexpected error" which
      // hides the stack from SvelteKit's dev logger. Log the original
      // before re-throwing so the dev terminal shows what actually
      // failed.
      console.error('[lemma editor load] unmapped error:', e);
    }
    throw error(mapped.status as 400 | 403 | 404, mapped.message);
  }
};

const lemmaPatchSchema = z.object({
  headword: z.string().min(1).max(128),
  pos: z.string().min(1).max(32),
  glossDefault: z
    .string()
    .max(500)
    .transform((s) => (s.trim().length === 0 ? null : s))
    .nullable(),
  frequencyRank: z
    .string()
    .transform((s) => (s.trim().length === 0 ? null : Number.parseInt(s, 10)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), {
      message: 'frequencyRank must be a non-negative integer',
    })
    .nullable(),
  sourceAttribution: z
    .string()
    .max(500)
    .transform((s) => (s.trim().length === 0 ? null : s))
    .nullable(),
  reason: z.string().max(500).optional().default(''),
});

/**
 * Per-field inline-edit schema. The new design opens each lemma field
 * as a click-to-edit input; on Enter / blur we POST the single field
 * the curator changed, instead of resubmitting every field. Saves a
 * round-trip when a curator only touches one column.
 */
const FIELD_NAMES = [
  'headword',
  'pos',
  'glossDefault',
  'frequencyRank',
  'sourceAttribution',
] as const;
const fieldPatchSchema = z.object({
  field: z.enum(FIELD_NAMES),
  value: z.string().max(500),
});

const lockSchema = z.object({
  locked: z.enum(['true', 'false']).transform((v) => v === 'true'),
  reason: z.string().max(500).optional().default(''),
});

const translationPatchSchema = z.object({
  translationId: z.string().regex(UUID_RE),
  body: z.string().min(1).max(500),
  promoteToCurator: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  hidden: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  reason: z.string().max(500).optional().default(''),
});

const hideSchema = z.object({
  translationId: z.string().regex(UUID_RE),
  hidden: z.enum(['true', 'false']).transform((v) => v === 'true'),
  reason: z.string().max(500).optional().default(''),
});

const mergeSchema = z.object({
  loserId: z.string().regex(UUID_RE),
  reason: z.string().max(500).optional().default(''),
});

const reorderSchema = z.object({
  // Comma- or whitespace-separated UUIDs. The form ships a hidden input
  // with the canonical order; we parse, dedupe, and validate the count
  // server-side via the service.
  orderedTranslationIds: z.string().min(1),
  reason: z.string().max(500).optional().default(''),
});

/**
 * Features are entered as a comma-separated `Key=Value` list ("Tense=Past,
 * Person=1, Number=Sing") — easier to type than JSON, and the popup pill
 * code already handles unknown keys gracefully so a typo can't crash the
 * render. Empty / whitespace-only input means "no features".
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

const formCreateSchema = z.object({
  surface: z.string().min(1).max(256),
  features: z.string().max(1024).optional().default(''),
  romanization: z
    .string()
    .max(256)
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s.trim() : null)),
});

const formUpdateSchema = z.object({
  formId: z.string().regex(UUID_RE),
  surface: z.string().min(1).max(256),
  features: z.string().max(1024).optional().default(''),
  romanization: z
    .string()
    .max(256)
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s.trim() : null)),
});

const formDeleteSchema = z.object({
  formId: z.string().regex(UUID_RE),
});

const setParadigmSchema = z.object({
  // Empty / "none" → clear the paradigm; otherwise must be a UUID.
  paradigmId: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || s === 'none' || UUID_RE.test(s), {
      message: 'paradigmId must be a UUID, "none", or empty',
    })
    .transform((s) => (s === '' || s === 'none' ? null : s)),
  stem: z
    .string()
    .max(64)
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s.trim() : null)),
});

const splitSchema = z.object({
  newHeadword: z.string().min(1).max(128),
  newPos: z.string().min(1).max(32),
  newGloss: z
    .string()
    .max(500)
    .transform((s) => (s.trim().length === 0 ? null : s))
    .nullable(),
  translationIds: z.string().optional(),
  reason: z.string().max(500).optional().default(''),
});

function editorFromLocals(locals: App.Locals) {
  if (!locals.user) throw new ForbiddenError('Unauthorized');
  return { id: locals.user.id, role: locals.user.role };
}

export const actions: Actions = {
  updateLemma: async ({ params, request, locals }) => {
    const editor = editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = lemmaPatchSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'lemma',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies LemmaFormResult);
    }
    try {
      await updateLemma(
        editor,
        params.id,
        {
          headword: parsed.data.headword,
          pos: parsed.data.pos,
          glossDefault: parsed.data.glossDefault,
          frequencyRank: parsed.data.frequencyRank,
          sourceAttribution: parsed.data.sourceAttribution,
        },
        parsed.data.reason,
      );
      return { ok: true, section: 'lemma' } satisfies LemmaFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'lemma',
        message: mapped.message,
      } satisfies LemmaFormResult);
    }
  },

  /**
   * Inline edit of a single lemma field. The header strip's click-to-
   * edit fields each POST `{field, value}` here on commit. Translates
   * the wire-shape into the typed `UpdateLemmaPatch` the service
   * expects, validating per-field bounds (frequencyRank → integer,
   * empty strings on optional fields → null).
   */
  patchLemmaField: async ({ params, request, locals }) => {
    const editor = editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = fieldPatchSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'lemma',
        field: String((form as { field?: string }).field ?? ''),
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      } satisfies FieldPatchResult);
    }
    const { field, value } = parsed.data;
    const trimmed = value.trim();
    const patch: Parameters<typeof updateLemma>[2] = {};
    try {
      if (field === 'headword') {
        if (trimmed.length === 0) throw new CuratorValidationError('headword cannot be empty');
        patch.headword = trimmed;
      } else if (field === 'pos') {
        if (trimmed.length === 0) throw new CuratorValidationError('pos cannot be empty');
        patch.pos = trimmed;
      } else if (field === 'glossDefault') {
        patch.glossDefault = trimmed.length === 0 ? null : trimmed;
      } else if (field === 'frequencyRank') {
        if (trimmed.length === 0) {
          patch.frequencyRank = null;
        } else {
          const n = Number.parseInt(trimmed, 10);
          if (!Number.isInteger(n) || n < 0) {
            throw new CuratorValidationError('frequencyRank must be a non-negative integer');
          }
          patch.frequencyRank = n;
        }
      } else if (field === 'sourceAttribution') {
        patch.sourceAttribution = trimmed.length === 0 ? null : trimmed;
      }
      await updateLemma(editor, params.id, patch, '');
      return { ok: true, section: 'lemma', field } satisfies FieldPatchResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'lemma',
        field,
        message: mapped.message,
      } satisfies FieldPatchResult);
    }
  },

  deleteLemma: async ({ params, locals }) => {
    const editor = editorFromLocals(locals);
    try {
      await deleteLemma(editor, params.id);
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'delete',
        message: mapped.message,
      } satisfies DeleteResult);
    }
    // Successful delete: kick the curator back to the dictionary list
    // with the language they were editing in scope.
    throw redirect(303, '/moderation/dictionary');
  },

  setLock: async ({ params, request, locals }) => {
    const editor = editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = lockSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'lock',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies LockFormResult);
    }
    try {
      await setLemmaLock(editor, params.id, parsed.data.locked, parsed.data.reason);
      return { ok: true, section: 'lock' } satisfies LockFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'lock',
        message: mapped.message,
      } satisfies LockFormResult);
    }
  },

  updateTranslation: async ({ request, locals }) => {
    const editor = editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = translationPatchSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'translation',
        translationId: (form.translationId as string | undefined) ?? null,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies TranslationFormResult);
    }
    try {
      await updateTranslation(
        editor,
        parsed.data.translationId,
        {
          body: parsed.data.body,
          promoteToCurator: parsed.data.promoteToCurator,
        },
        parsed.data.reason,
      );
      return {
        ok: true,
        section: 'translation',
        translationId: parsed.data.translationId,
      } satisfies TranslationFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'translation',
        translationId: parsed.data.translationId,
        message: mapped.message,
      } satisfies TranslationFormResult);
    }
  },

  setTranslationHidden: async ({ request, locals }) => {
    const editor = editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = hideSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'translation',
        translationId: (form.translationId as string | undefined) ?? null,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies TranslationFormResult);
    }
    try {
      await setTranslationHidden(
        editor,
        parsed.data.translationId,
        parsed.data.hidden,
        parsed.data.reason,
      );
      return {
        ok: true,
        section: 'translation',
        translationId: parsed.data.translationId,
      } satisfies TranslationFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'translation',
        translationId: parsed.data.translationId,
        message: mapped.message,
      } satisfies TranslationFormResult);
    }
  },

  merge: async ({ params, request, locals }) => {
    const editor = editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = mergeSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'merge',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies MergeFormResult);
    }
    try {
      await mergeLemmas(
        editor,
        { winnerId: params.id, loserId: parsed.data.loserId },
        parsed.data.reason,
      );
      return { ok: true, section: 'merge' } satisfies MergeFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'merge',
        message: mapped.message,
      } satisfies MergeFormResult);
    }
  },

  reorderTranslations: async ({ params, request, locals }) => {
    const editor = editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = reorderSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'reorder',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      } satisfies ReorderFormResult);
    }
    const orderedIds = parsed.data.orderedTranslationIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => UUID_RE.test(s));
    if (orderedIds.length === 0) {
      return fail(400, {
        ok: false,
        section: 'reorder',
        message: 'No valid translation ids in orderedTranslationIds',
      } satisfies ReorderFormResult);
    }
    try {
      await reorderTranslations(
        editor,
        params.id,
        orderedIds,
        parsed.data.reason,
      );
      return { ok: true, section: 'reorder' } satisfies ReorderFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'reorder',
        message: mapped.message,
      } satisfies ReorderFormResult);
    }
  },

  split: async ({ params, request, locals }) => {
    const editor = editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = splitSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'split',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies SplitFormResult);
    }
    const translationIds = (parsed.data.translationIds ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => UUID_RE.test(s));
    try {
      const result = await splitLemma(
        editor,
        {
          fromLemmaId: params.id,
          newLemma: {
            headword: parsed.data.newHeadword,
            pos: parsed.data.newPos,
            glossDefault: parsed.data.newGloss,
          },
          translationIds,
        },
        parsed.data.reason,
      );
      return {
        ok: true,
        section: 'split',
        newLemmaId: result.created.id,
      } satisfies SplitFormResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'split',
        message: mapped.message,
      } satisfies SplitFormResult);
    }
  },

  // ─── Form-editor actions ───────────────────────────────────────────
  // The five operations the curator can take on a lemma's
  // `lemma_forms` rows + paradigm assignment. `addForm`, `editForm`,
  // and `removeForm` mutate one row at a time. `setParadigm` writes
  // the lemma's paradigm + stem (without touching forms — the
  // curator decides when to regenerate). `regenerateForms` wipes
  // every non-curator form on the lemma and rebuilds from the
  // assigned paradigm.

  addForm: async ({ params, request, locals }) => {
    editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = formCreateSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'form',
        action: 'add',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies FormSectionResult);
    }
    try {
      await createForm({
        lemmaId: params.id,
        surface: parsed.data.surface,
        features: parseFeatureString(parsed.data.features),
        romanization: parsed.data.romanization ?? null,
        createdBy: 'curator',
      });
      return { ok: true, section: 'form', action: 'add' } satisfies FormSectionResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'form',
        action: 'add',
        message: mapped.message,
      } satisfies FormSectionResult);
    }
  },

  editForm: async ({ request, locals }) => {
    editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = formUpdateSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'form',
        action: 'edit',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies FormSectionResult);
    }
    try {
      await updateForm(parsed.data.formId, {
        surface: parsed.data.surface,
        features: parseFeatureString(parsed.data.features),
        romanization: parsed.data.romanization ?? null,
      });
      return { ok: true, section: 'form', action: 'edit' } satisfies FormSectionResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'form',
        action: 'edit',
        message: mapped.message,
      } satisfies FormSectionResult);
    }
  },

  removeForm: async ({ request, locals }) => {
    editorFromLocals(locals);
    const form = Object.fromEntries(await request.formData());
    const parsed = formDeleteSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'form',
        action: 'remove',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies FormSectionResult);
    }
    try {
      await deleteForm(parsed.data.formId);
      return { ok: true, section: 'form', action: 'remove' } satisfies FormSectionResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'form',
        action: 'remove',
        message: mapped.message,
      } satisfies FormSectionResult);
    }
  },

  setParadigm: async ({ params, request, locals }) => {
    const editor = editorFromLocals(locals);
    // Only admins re-shape paradigm assignments; curators see the
    // form list but can't change the paradigm pointer (mirrors the
    // existing lock action's gating). Adjust if the user wants
    // looser permissions later.
    if (!isAdmin({ role: editor.role })) {
      return fail(403, {
        ok: false,
        section: 'paradigm',
        action: 'set',
        message: 'Admin role required to set a paradigm',
      } satisfies ParadigmSectionResult);
    }
    const form = Object.fromEntries(await request.formData());
    const parsed = setParadigmSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'paradigm',
        action: 'set',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies ParadigmSectionResult);
    }
    try {
      await setLemmaParadigm(params.id, {
        paradigmId: parsed.data.paradigmId,
        stem: parsed.data.stem,
      });
      return { ok: true, section: 'paradigm', action: 'set' } satisfies ParadigmSectionResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'paradigm',
        action: 'set',
        message: mapped.message,
      } satisfies ParadigmSectionResult);
    }
  },

  regenerateForms: async ({ params, locals }) => {
    const editor = editorFromLocals(locals);
    if (!isAdmin({ role: editor.role })) {
      return fail(403, {
        ok: false,
        section: 'paradigm',
        action: 'regenerate',
        message: 'Admin role required to regenerate forms',
      } satisfies ParadigmSectionResult);
    }
    try {
      await regenerateForms(params.id);
      return {
        ok: true,
        section: 'paradigm',
        action: 'regenerate',
      } satisfies ParadigmSectionResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'paradigm',
        action: 'regenerate',
        message: mapped.message,
      } satisfies ParadigmSectionResult);
    }
  },
};
