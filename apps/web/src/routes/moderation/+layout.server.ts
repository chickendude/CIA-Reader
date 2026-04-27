/**
 * Moderation section guard (T-3.7).
 *
 * Blocks unauthenticated and non-curator visitors from every route under
 * /moderation. The curator/admin distinction (and per-language scope) is
 * enforced again in the service layer — this guard is cosmetic / UX,
 * not a security boundary. It exists so an ordinary user never sees a
 * half-rendered moderation page.
 */
import { error, redirect } from '@sveltejs/kit';
import { listGrantedLanguages } from '$lib/server/dictionary/permissions.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  const role = locals.user.role;
  if (role !== 'curator' && role !== 'admin') {
    throw error(403, 'Curator or admin role required');
  }
  const grantedLanguages = await listGrantedLanguages({
    id: locals.user.id,
    role,
  });
  return {
    moderator: {
      id: locals.user.id,
      role,
      grantedLanguages,
    },
  };
};
