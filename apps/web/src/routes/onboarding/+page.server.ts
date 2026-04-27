import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { completeOnboarding, type LanguageBaseline } from '$lib/server/onboarding.js';
import {
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  type LanguageCode,
} from '@ciareader/shared-types';
import type { Actions, PageServerLoad } from './$types';

const BASELINES: readonly LanguageBaseline[] = ['none', 'beginner', 'intermediate'] as const;

const onboardingSchema = z.object({
  language: z.enum(SUPPORTED_LANGUAGE_CODES as readonly [LanguageCode, ...LanguageCode[]]),
  baseline: z.enum(BASELINES as readonly [LanguageBaseline, ...LanguageBaseline[]]),
});

export const load: PageServerLoad = ({ locals, url }) => {
  if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  // A user who's already onboarded should not see the picker again — the
  // profile page exposes per-language edits.
  if (locals.user.onboardedAt !== null) throw redirect(303, '/');

  return {
    languages: SUPPORTED_LANGUAGE_CODES.map((code) => ({
      code,
      displayName: LANGUAGES[code].displayName,
      nativeName: LANGUAGES[code].nativeName,
      script: LANGUAGES[code].script,
    })),
    baselines: BASELINES,
  };
};

type OnboardingResult =
  | { ok: true }
  | { ok: false; message: string };

export const actions: Actions = {
  default: async ({ locals, request }) => {
    if (!locals.user) {
      return fail(401, { ok: false, message: 'Unauthorized' } satisfies OnboardingResult);
    }
    if (locals.user.onboardedAt !== null) {
      // A concurrent submit after the page raced a completion — just succeed.
      return { ok: true } satisfies OnboardingResult;
    }
    const form = Object.fromEntries(await request.formData());
    const parsed = onboardingSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      } satisfies OnboardingResult);
    }
    await completeOnboarding(locals.user.id, parsed.data.language, parsed.data.baseline);
    throw redirect(303, '/');
  },
};
