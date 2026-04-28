/**
 * PUT /api/v1/me/current-language (T-5.25).
 *
 * Sets the cia_lang cookie that the layout loader uses to drive the
 * rail's language indicator. Body: `{ code: 'hi' | 'mr' | 'or' }`.
 * The handler accepts any supported code — the resolver in
 * `language-context.ts` will fall back to one of the user's active
 * languages if the cookie ever becomes stale.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from '$lib/server/language-context.js';
import { isSupportedLanguage } from '@ciareader/shared-types';
import type { RequestHandler } from './$types';

const body = z.object({
  code: z.string().refine(isSupportedLanguage, {
    message: 'Unsupported language',
  }),
});

export const PUT: RequestHandler = async ({ request, cookies }) => {
  let parsed: { code: string };
  try {
    const json_body = await request.json();
    const result = body.safeParse(json_body);
    if (!result.success) throw error(400, 'Invalid body');
    parsed = result.data;
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, 'Invalid JSON body');
  }

  cookies.set(LANG_COOKIE, parsed.code, {
    path: '/',
    maxAge: LANG_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false, // Client reads it for optimistic updates if needed.
  });

  return json({ code: parsed.code });
};
