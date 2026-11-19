/**
 * Group the signed-in reader's own translations first. Anonymous readers have no personal
 * translations.
 */
import { error, json } from '@sveltejs/kit';

import { loadKnownStatusMap } from '$lib/server/texts/tokens.js';
import { getHeadwordRomanization } from '$lib/server/dictionary/lemma-forms.js';
import { resolveUser } from '$lib/server/auth/require-user.js';
import { canEditDictionary } from '$lib/server/dictionary/permissions.js';
import {
  getLemmaTranslations,
  LemmaNotFoundError,
} from '$lib/server/dictionary/lookups.js';
import type { RequestHandler } from './$types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async (event) => {
  const { id } = event.params;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid lemma id');

  const user = await resolveUser(event);
  const viewer = user ? { id: user.id, role: user.role } : null;

  try {
    const result = await getLemmaTranslations(id, viewer);
    const [romanization, canEdit, statuses] = await Promise.all([
      getHeadwordRomanization(result.lemma),
      canEditDictionary(user, result.lemma.language),
      new URL(event.request.url).searchParams.has('studyStatus') ? loadKnownStatusMap(user?.id ?? null, [id]) : undefined,
    ]);
    return json({ ...result, lemma: { ...result.lemma, romanization }, canEdit,
      ...(statuses && { studyStatus: statuses.get(id) ?? 'unknown' }) });
  } catch (err) {
    if (err instanceof LemmaNotFoundError) throw error(404, 'Lemma not found');
    throw err;
  }
};
