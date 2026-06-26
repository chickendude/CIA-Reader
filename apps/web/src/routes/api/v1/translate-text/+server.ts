/**
 * POST /api/v1/translate-text
 *
 * Body: { text, language, targetLanguage?, cachedOnly? }
 *
 * Translate a caller-supplied sentence (a subtitle line) — unlike
 * `/translate-sentence`, which reconstructs the sentence server-side from a
 * chapter/token. Built for thin clients that hold their own text (the Primeran
 * subtitle-mining extension). Auth-gated; result cached globally by
 * (language, targetLanguage, model, sha256(text)). Returns { translation, cached }.
 *
 * `cachedOnly: true` makes it a pure cache lookup (never calls OpenAI) so a
 * client can show an already-saved translation without spending on the API.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { isSupportedLanguage } from '@ciareader/shared-types';

import { requireUser } from '$lib/server/auth/require-user.js';
import { OPENAI_MODEL } from '$lib/server/env.js';
import { OpenAiNotConfiguredError, translateSentence } from '$lib/server/openai-client.js';
import {
  getCachedTranslation,
  hashSentence,
  setCachedTranslation,
} from '$lib/server/sentence-translation-cache.js';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.string(),
  targetLanguage: z.string().min(2).max(8).optional(),
  cachedOnly: z.boolean().optional(),
});

export const POST: RequestHandler = async (event) => {
  await requireUser(event);

  const parsed = bodySchema.safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid body');

  const { text, language } = parsed.data;
  if (!isSupportedLanguage(language)) throw error(400, 'Unsupported language');

  const targetLanguage = parsed.targetLanguage ?? 'en';
  const key = {
    language,
    targetLanguage,
    model: OPENAI_MODEL,
    textHash: hashSentence(text),
  };

  const cached = await getCachedTranslation(key);
  if (cached) return json({ translation: cached, cached: true });

  if (parsed.data.cachedOnly) return json({ translation: null, cached: false });

  try {
    const translation = await translateSentence(text, language, targetLanguage);
    await setCachedTranslation(key, text, translation);
    return json({ translation, cached: false });
  } catch (e) {
    if (e instanceof OpenAiNotConfiguredError) {
      throw error(503, 'Sentence translation is not configured');
    }
    const message = e instanceof Error && e.message ? e.message : 'Translation failed';
    throw error(502, message);
  }
};
