/**
 * /collections/new (T-8.1) — owner picks language + kind + title,
 * then we redirect to the detail page where they add texts.
 */
import { redirect } from '@sveltejs/kit';

import { LANGUAGES } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  return {
    languages: Object.values(LANGUAGES).map((l) => ({
      code: l.code,
      displayName: l.displayName,
      nativeName: l.nativeName,
    })),
  };
};
