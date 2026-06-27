/**
 * POST /api/v1/me/lemmas
 *
 * Get-or-create a dictionary lemma for (language, headword) so the caller can
 * attach a personal translation to a word the dictionary doesn't have yet
 * (the Primeran extension's "add a translation to an unknown word" flow).
 * Created lemmas are `source: 'user'`. Returns the public lemma shape.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import { publicLemma } from '$lib/server/dictionary/browse.js';
import { ensureUserLemma, MAX_HEADWORD_LEN, UserLemmaError } from '$lib/server/dictionary/user-lemmas.js';
import { parseJson } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const body = z.object({
  language: z.string().refine(isSupportedLanguage, 'unsupported language'),
  headword: z.string().min(1).max(MAX_HEADWORD_LEN),
  pos: z.string().min(1).max(40).optional(),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
  const input = await parseJson(event.request, body);
  try {
    const lemma = await ensureUserLemma({
      userId: user.id,
      language: input.language as LanguageCode,
      headword: input.headword,
      pos: input.pos ?? null,
    });
    return json({ lemma: publicLemma(lemma) }, { status: 201 });
  } catch (e) {
    if (e instanceof UserLemmaError) throw error(e.status, e.message);
    throw e;
  }
};
