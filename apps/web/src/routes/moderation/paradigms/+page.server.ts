/**
 * Admin paradigm registry (curator-paradigm follow-up).
 *
 * Lists every paradigm row with optional (language, pos) filters and
 * exposes a create-paradigm action. Per-paradigm slot editing lives in
 * the `[id]/+page.server.ts` sibling. The page is admin-only at the
 * loader and the action level — a curator without admin role lands on
 * a 403 instead of a half-rendered "you can't change anything" view.
 *
 * Naming alongside the existing `paradigms.ts` service keeps every
 * paradigm write inside one module so a future audit-row helper can
 * be added in one place.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

import {
  createParadigm,
  listParadigms,
  ParadigmValidationError,
} from '$lib/server/dictionary/paradigms.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { LANGUAGES, isSupportedLanguage } from '@ciareader/shared-types';
import type { LanguageCode } from '@ciareader/shared-types';
import type { Actions, PageServerLoad } from './$types';

type CreateResult =
  | { ok: true; section: 'create'; paradigmId: string }
  | { ok: false; section: 'create'; message: string };

function mapError(e: unknown): { status: number; message: string } {
  if (e instanceof ParadigmValidationError) {
    return { status: e.status, message: e.message };
  }
  return { status: 500, message: 'Unexpected error' };
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (!isAdmin({ role: locals.user.role })) {
    throw error(403, 'Paradigm editor requires admin role');
  }

  const langParam = url.searchParams.get('language');
  const posParam = url.searchParams.get('pos');
  const language: LanguageCode | null =
    langParam && isSupportedLanguage(langParam) ? (langParam as LanguageCode) : null;
  const pos = posParam && posParam.trim().length > 0 ? posParam.trim() : null;

  const paradigms = await listParadigms({
    language,
    pos,
  });

  return {
    paradigms,
    languages: Object.values(LANGUAGES).map((d) => ({
      code: d.code,
      displayName: d.displayName,
      nativeName: d.nativeName,
    })),
    filter: { language, pos },
  };
};

const createSchema = z.object({
  language: z.string().min(1),
  pos: z.string().min(1).max(32),
  name: z.string().min(1).max(128),
  description: z
    .string()
    .max(1000)
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s : null)),
});

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.user || !isAdmin({ role: locals.user.role })) {
      return fail(403, {
        ok: false,
        section: 'create',
        message: 'Admin role required',
      } satisfies CreateResult);
    }
    const form = Object.fromEntries(await request.formData());
    const parsed = createSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'create',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies CreateResult);
    }
    try {
      const row = await createParadigm({
        language: parsed.data.language,
        pos: parsed.data.pos,
        name: parsed.data.name,
        description: parsed.data.description,
      });
      return {
        ok: true,
        section: 'create',
        paradigmId: row.id,
      } satisfies CreateResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'create',
        message: mapped.message,
      } satisfies CreateResult);
    }
  },
};
