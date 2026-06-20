/**
 * DELETE /api/v1/admin/users/:id/curator-languages/:language (T-3.4).
 *
 * Admin-only. Revokes a per-language curator grant. Silent success
 * whether or not the grant existed — the caller only cares about the
 * post-condition ("user does not have a grant on `language`").
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  listCuratorLanguages,
  revokeCuratorLanguage,
} from '$lib/server/dictionary/admin.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import type { RequestHandler } from './$types';
import { SUPPORTED_LANGUAGE_CODES } from '@ciareader/shared-types';

const SUPPORTED = new Set<string>(SUPPORTED_LANGUAGE_CODES);

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!isAdmin(user)) throw error(403, 'Admin role required');
  const { id, language } = event.params;
  if (!id) throw error(400, 'Missing user id');
  if (!language || !SUPPORTED.has(language)) throw error(400, 'Unsupported language');
  await revokeCuratorLanguage(id, language as 'hi' | 'mr' | 'or');
  const languages = await listCuratorLanguages(id);
  return json({ languages });
};
