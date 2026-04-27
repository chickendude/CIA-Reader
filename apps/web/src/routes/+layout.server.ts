import type { LayoutServerLoad } from './$types';

/**
 * Layout-level loader so every page gets the current user without each
 * +page.server.ts needing to re-pick it off locals. Kept to a small,
 * serializable shape — anything touching secret fields must still go
 * through requireUser on a per-route basis.
 */
export const load: LayoutServerLoad = ({ locals }) => {
  if (!locals.user) return { user: null };
  return {
    user: {
      id: locals.user.id,
      email: locals.user.email,
      displayName: locals.user.displayName,
      role: locals.user.role,
    },
  };
};
