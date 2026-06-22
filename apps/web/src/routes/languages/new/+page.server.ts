/**
 * Add a language (#436).
 *
 * A dedicated page — reached from the rail switcher's "Add a language"
 * button — for adding a language you don't read yet. Lists the
 * not-yet-added supported languages plus a proficiency baseline (mirroring
 * onboarding), adds the chosen one, makes it current, and drops you in the
 * library for it.
 *
 * Auth required; anonymous visitors are bounced to /login.
 */
import { fail, redirect } from '@sveltejs/kit';

import { listUserLanguages } from '$lib/server/profile.js';
import {
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  addableLanguageOptions,
} from '$lib/server/language-context.js';
import { addUserLanguage } from '$lib/server/user-languages.js';
import type { LanguageBaseline } from '$lib/server/onboarding.js';
import { isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';
import type { Actions, PageServerLoad } from './$types';

const BASELINES = ['none', 'beginner', 'intermediate'] as const;

function isBaseline(v: string): v is LanguageBaseline {
  return (BASELINES as readonly string[]).includes(v);
}

async function activeCodesFor(userId: string): Promise<LanguageCode[]> {
  const rows = await listUserLanguages(userId);
  return rows.map((r) => r.language as LanguageCode);
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const addable = addableLanguageOptions(await activeCodesFor(locals.user.id));
  return { addable, baselines: BASELINES };
};

type AddResult = { ok: false; message: string };

export const actions: Actions = {
  default: async ({ request, locals, cookies, url }) => {
    if (!locals.user) {
      throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
    }
    const fd = await request.formData();
    const code = fd.get('language')?.toString() ?? '';
    const baseline = fd.get('baseline')?.toString() ?? 'none';

    if (!isSupportedLanguage(code)) {
      return fail(400, { ok: false, message: 'Pick a language to add.' } satisfies AddResult);
    }
    if (!isBaseline(baseline)) {
      return fail(400, { ok: false, message: 'Pick how much you already know.' } satisfies AddResult);
    }

    // Already reading it? Just switch — don't clobber an existing baseline.
    const active = await activeCodesFor(locals.user.id);
    if (!active.includes(code as LanguageCode)) {
      await addUserLanguage(locals.user.id, code as LanguageCode, baseline);
    }

    // Make it current (add == switch) and land in its library.
    cookies.set(LANG_COOKIE, code, {
      path: '/',
      maxAge: LANG_COOKIE_MAX_AGE,
      sameSite: 'lax',
      httpOnly: false,
    });
    throw redirect(303, '/library');
  },
};
