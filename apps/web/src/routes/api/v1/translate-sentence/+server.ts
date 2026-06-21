/**
 * POST /api/v1/translate-sentence
 *
 * Body: { chapterId, tokenIdx, language, targetLanguage?, cachedOnly? }
 *
 * Reconstructs the sentence around the given token (server-side, so we don't
 * trust client text), translates it with OpenAI (gpt-4o by default), and caches
 * the result globally. Auth-gated. Returns { sentence, translation, cached }.
 *
 * `cachedOnly: true` makes it a pure cache lookup: returns the saved translation
 * if one exists, or `{ translation: null }` on a miss — never calling OpenAI.
 * The reader uses this to show an already-saved translation the moment a word
 * opens, without re-spending on the API.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { OPENAI_MODEL } from '$lib/server/env.js';
import {
  OpenAiNotConfiguredError,
  translateSentence,
} from '$lib/server/openai-client.js';
import {
  getCachedTranslation,
  hashSentence,
  setCachedTranslation,
} from '$lib/server/sentence-translation-cache.js';
import { sentenceAround } from '$lib/server/texts/sentences.js';
import { isSupportedLanguage } from '@ciareader/shared-types';
import type { RequestHandler } from './$types';

const body = z.object({
  chapterId: z.string().uuid(),
  tokenIdx: z.number().int().nonnegative(),
  language: z.string().refine(isSupportedLanguage, 'Unsupported language'),
  targetLanguage: z.string().min(2).max(8).optional(),
  cachedOnly: z.boolean().optional(),
});

export const POST: RequestHandler = async (event) => {
  await requireUser(event);

  let parsed: z.infer<typeof body>;
  try {
    const result = body.safeParse(await event.request.json());
    if (!result.success) throw error(400, 'Invalid body');
    parsed = result.data;
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, 'Invalid JSON body');
  }

  const sentence = await sentenceAround(parsed.chapterId, parsed.tokenIdx);
  if (!sentence) throw error(422, 'Could not find a sentence for that token');

  const targetLanguage = parsed.targetLanguage ?? 'en';
  const key = {
    language: parsed.language,
    targetLanguage,
    model: OPENAI_MODEL,
    textHash: hashSentence(sentence),
  };

  const cached = await getCachedTranslation(key);
  if (cached) return json({ sentence, translation: cached, cached: true });

  // Cache-only lookup (reader popup open): never spend on OpenAI for a miss.
  if (parsed.cachedOnly) return json({ sentence, translation: null, cached: false });

  try {
    const translation = await translateSentence(sentence, parsed.language, targetLanguage);
    await setCachedTranslation(key, sentence, translation);
    return json({ sentence, translation, cached: false });
  } catch (e) {
    if (e instanceof OpenAiNotConfiguredError) {
      throw error(503, 'Sentence translation is not configured');
    }
    // Surface the upstream reason (e.g. quota/billing) so the UI can show
    // something actionable rather than a bare 502.
    const message = e instanceof Error && e.message ? e.message : 'Translation failed';
    throw error(502, message);
  }
};
