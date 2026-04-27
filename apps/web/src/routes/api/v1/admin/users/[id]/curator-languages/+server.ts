/**
 * GET/POST /api/v1/admin/users/:id/curator-languages (T-3.4).
 *
 * Admin-only. Lists or grants per-language curator rights.
 * Individual revoke is at `./[language]`.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  grantCuratorLanguage,
  listCuratorLanguages,
  UserNotFoundError,
} from '$lib/server/dictionary/admin.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../../auth/_helpers.js';

const body = z.object({
  language: z.enum(['hi', 'mr', 'or']),
});

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!isAdmin(user)) throw error(403, 'Admin role required');
  if (!event.params.id) throw error(400, 'Missing user id');
  const languages = await listCuratorLanguages(event.params.id);
  return json({ languages });
};

export const POST: RequestHandler = async (event) => {
  const admin = await requireUser(event);
  if (!isAdmin(admin)) throw error(403, 'Admin role required');
  if (!event.params.id) throw error(400, 'Missing user id');
  const input = await parseJson(event.request, body);
  try {
    await grantCuratorLanguage(event.params.id, input.language, admin.id);
    const languages = await listCuratorLanguages(event.params.id);
    return json({ languages }, { status: 201 });
  } catch (err) {
    if (err instanceof UserNotFoundError) throw error(404, 'User not found');
    throw err;
  }
};
