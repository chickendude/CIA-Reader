/**
 * GET + PATCH /api/v1/admin/phrases/:id (T-14.4a).
 *
 * Curator dictionary editor detail view + edit. Mirror of the
 * lemma editor's GET/PATCH from T-3.7, scoped to phrases.
 *
 * GET returns the full editor view (phrase + tokens + every
 * translation including hidden + chapter occurrences + recent
 * audit history). PATCH updates editable fields and implicitly
 * flips `curator_locked=true`.
 *
 * Permission: curator or admin with edit rights on the phrase's
 * language.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  getPhraseEditorView,
  publicPhrase,
  updatePhraseFields,
  PhraseValidationError,
} from '$lib/server/phrases.js';
import { publicTranslation } from '$lib/server/dictionary/translations.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import {
  ForbiddenError,
  requireCanEditDictionary,
} from '$lib/server/dictionary/permissions.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchBody = z.object({
  glossDefault: z.string().max(500).nullable().optional(),
  pos: z.string().max(32).nullable().optional(),
  frequencyRank: z.number().int().min(0).nullable().optional(),
  sourceAttribution: z.string().max(200).nullable().optional(),
  reason: z.string().min(3),
});

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid phrase id');

  const view = await getPhraseEditorView(id);
  if (!view) throw error(404, 'Phrase not found');

  try {
    await requireCanEditDictionary(user, view.phrase.language as LanguageCode);
    return json({
      phrase: { ...publicPhrase(view.phrase, view.tokens), hidden: view.phrase.hidden },
      // T-14.4a: editor surfaces every translation including
      // hidden — the moderation toggle lives on the phrase
      // editor and the curator needs to see what's been hidden.
      translations: view.translations.map(publicTranslation),
      chapterIds: view.chapterIds,
      history: view.history,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) throw error(403, err.message);
    throw err;
  }
};

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid phrase id');
  const input = await parseJson(event.request, patchBody);

  // Resolve the phrase first so the language-scoped permission
  // check has the language to check against.
  const view = await getPhraseEditorView(id);
  if (!view) throw error(404, 'Phrase not found');

  try {
    await requireCanEditDictionary(user, view.phrase.language as LanguageCode);
    const updated = await updatePhraseFields({
      phraseId: id,
      patch: {
        glossDefault: input.glossDefault,
        pos: input.pos,
        frequencyRank: input.frequencyRank,
        sourceAttribution: input.sourceAttribution,
      },
      editorId: user.id,
      reason: input.reason,
    });
    return json({
      phrase: {
        ...publicPhrase(updated, view.tokens),
        hidden: updated.hidden,
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) throw error(403, err.message);
    if (err instanceof MissingReasonError) throw error(400, err.message);
    if (err instanceof PhraseValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
