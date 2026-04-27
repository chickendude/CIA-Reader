import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
  listUserLanguages,
  updateUserProfile,
  upsertUserLanguage,
  withDefaultsForAllLanguages,
} from '$lib/server/profile.js';
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE } from '$lib/theme/index.js';
import {
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguage,
} from '@ciareader/shared-types';
import type { Actions, PageServerLoad } from './$types';

const profileFormSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(80)
    .transform((s) => (s.length === 0 ? null : s))
    .nullable(),
  themePreference: z.enum(['system', 'light', 'dark']),
});

const languageFormSchema = z.object({
  code: z.string(),
  scriptPreference: z.enum(['native', 'native_with_romanization', 'romanization_only']),
  romanizationScheme: z.enum(['iso15919', 'iast', 'hunterian', 'itrans']),
});

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login?next=/profile');

  const persisted = await listUserLanguages(locals.user.id);
  return {
    user: {
      id: locals.user.id,
      email: locals.user.email,
      displayName: locals.user.displayName,
      role: locals.user.role,
      themePreference: locals.user.themePreference,
    },
    languages: withDefaultsForAllLanguages(persisted).map((row) => ({
      ...row,
      displayName: LANGUAGES[row.code].displayName,
      nativeName: LANGUAGES[row.code].nativeName,
      script: LANGUAGES[row.code].script,
      supportedRomanizations: LANGUAGES[row.code].supportedRomanizations,
    })),
  };
};

// All action responses carry a `section` tag so the Svelte template can narrow
// ok vs. error variants by section without juggling separate union members.
type ProfileActionResult =
  | { ok: true; section: 'profile' }
  | { ok: false; section: 'profile'; message: string };
type LanguageActionResult =
  | { ok: true; section: 'language'; code: string }
  | { ok: false; section: 'language'; code: string | null; message: string };

export const actions: Actions = {
  updateProfile: async ({ cookies, request, locals, url }) => {
    if (!locals.user) {
      return fail(401, {
        ok: false,
        section: 'profile',
        message: 'Unauthorized',
      } satisfies ProfileActionResult);
    }
    const form = Object.fromEntries(await request.formData());
    const parsed = profileFormSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'profile',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies ProfileActionResult);
    }
    await updateUserProfile(locals.user.id, parsed.data);
    // Also write the non-HttpOnly theme cookie so the pre-paint script in
    // app.html can honor this preference on the very next request — before
    // SSR has a chance to inject the resolved theme into the HTML. Survives
    // a logout because the users table isn't consulted for anon visitors.
    cookies.set(THEME_COOKIE, parsed.data.themePreference, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: THEME_COOKIE_MAX_AGE,
    });
    return { ok: true, section: 'profile' } satisfies ProfileActionResult;
  },

  updateLanguage: async ({ request, locals }) => {
    if (!locals.user) {
      return fail(401, {
        ok: false,
        section: 'language',
        code: null,
        message: 'Unauthorized',
      } satisfies LanguageActionResult);
    }
    const form = Object.fromEntries(await request.formData());
    const parsed = languageFormSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'language',
        code: (form.code as string | undefined) ?? null,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies LanguageActionResult);
    }
    if (!isSupportedLanguage(parsed.data.code)) {
      return fail(400, {
        ok: false,
        section: 'language',
        code: parsed.data.code,
        message: `Unsupported language '${parsed.data.code}'. Supported: ${SUPPORTED_LANGUAGE_CODES.join(', ')}`,
      } satisfies LanguageActionResult);
    }
    // Reject romanization schemes the registry says this language doesn't support.
    // Otherwise a user could set Odia to a scheme the registry doesn't advertise for it.
    const allowed = LANGUAGES[parsed.data.code].supportedRomanizations;
    if (!(allowed as readonly string[]).includes(parsed.data.romanizationScheme)) {
      return fail(400, {
        ok: false,
        section: 'language',
        code: parsed.data.code,
        message: `Romanization '${parsed.data.romanizationScheme}' is not supported for ${parsed.data.code}. Allowed: ${allowed.join(', ')}`,
      } satisfies LanguageActionResult);
    }
    await upsertUserLanguage(locals.user.id, parsed.data.code, {
      scriptPreference: parsed.data.scriptPreference,
      romanizationScheme: parsed.data.romanizationScheme,
    });
    return {
      ok: true,
      section: 'language',
      code: parsed.data.code,
    } satisfies LanguageActionResult;
  },
};
