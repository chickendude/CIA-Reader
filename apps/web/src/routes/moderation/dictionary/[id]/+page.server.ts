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
  getLemmaEditorView,
  mergeLemmas,
  setLemmaLock,
  setTranslationHidden,
  splitLemma,
  updateLemma,
  updateTranslation,
} from '$lib/server/dictionary/curator.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
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

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  if (!UUID_RE.test(params.id)) throw error(400, 'Invalid lemma id');
  try {
    const view = await getLemmaEditorView(
      { id: locals.user.id, role: locals.user.role },
      params.id,
    );
    return { ...view };
  } catch (e) {
    const mapped = mapError(e);
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
  reason: z.string().min(3).max(500),
});

const lockSchema = z.object({
  locked: z.enum(['true', 'false']).transform((v) => v === 'true'),
  reason: z.string().min(3).max(500),
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
  reason: z.string().min(3).max(500),
});

const hideSchema = z.object({
  translationId: z.string().regex(UUID_RE),
  hidden: z.enum(['true', 'false']).transform((v) => v === 'true'),
  reason: z.string().min(3).max(500),
});

const mergeSchema = z.object({
  loserId: z.string().regex(UUID_RE),
  reason: z.string().min(3).max(500),
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
  reason: z.string().min(3).max(500),
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
};
