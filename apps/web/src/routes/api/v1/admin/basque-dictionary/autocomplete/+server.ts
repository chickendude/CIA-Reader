/**
 * GET /api/v1/admin/basque-dictionary/autocomplete?term=<term>
 *
 * Admin-only proxy for Elhuyar's Basque autocomplete. Returns the candidate
 * headwords for a search term so a curator can pick the exact entry (case +
 * spelling matter — "Afrika" ≠ "afrikaans") instead of trusting the parsed
 * lemma. Reference-only: nothing is stored. Non-admins get 403.
 */
import { error, json } from '@sveltejs/kit';

import { searchElhuyarAutocomplete } from '$lib/server/dictionary/basque-reference.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import type { RequestHandler } from './$types';

const MAX_TERM_LENGTH = 80;

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!isAdmin({ role: locals.user.role })) throw error(403, 'Admin role required');

  const term = (url.searchParams.get('term') ?? '').trim();
  if (!term) return json({ term: '', terms: [] });
  if (term.length > MAX_TERM_LENGTH) throw error(400, 'Term too long');

  try {
    const terms = await searchElhuyarAutocomplete(term);
    return json({ term, terms });
  } catch {
    // Autocomplete is a convenience — a flaky upstream shouldn't 500 the panel.
    return json({ term, terms: [] });
  }
};
