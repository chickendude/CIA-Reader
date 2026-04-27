import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/require-user.js';
import { updateUserProfile } from '$lib/server/profile.js';
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE } from '$lib/theme/index.js';
import { parseJson, publicUser } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  return json({ user: publicUser(user) });
};

const patchSchema = z
  .object({
    displayName: z.string().trim().max(80).nullable(),
    themePreference: z.enum(['system', 'light', 'dark']),
  })
  .partial()
  .refine((v) => v.displayName !== undefined || v.themePreference !== undefined, {
    message: 'At least one field (displayName, themePreference) must be provided',
  });

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const patch = await parseJson(event.request, patchSchema);
  const updated = await updateUserProfile(user.id, patch);
  if (patch.themePreference !== undefined) {
    event.cookies.set(THEME_COOKIE, patch.themePreference, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: event.url.protocol === 'https:',
      maxAge: THEME_COOKIE_MAX_AGE,
    });
  }
  return json({ user: publicUser(updated) });
};
