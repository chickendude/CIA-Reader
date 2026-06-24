/**
 * POST /api/v1/parse
 *
 * Tokenize + lemmatize a short piece of text (one subtitle line / a few cues)
 * for thin clients that can't reach the internal NLP service — primarily the
 * Primeran subtitle-mining extension. Authenticated so this isn't an open NLP
 * proxy; the `text` length is capped so it can't be abused as a book pipeline
 * (the real upload flow handles long documents).
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { isSupportedLanguage } from '@ciareader/shared-types';

import { requireUser } from '$lib/server/auth/require-user.js';
import { tokenizeText } from '$lib/server/parse.js';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
  language: z.string(),
  text: z.string().min(1).max(2000),
});

export const POST: RequestHandler = async (event) => {
  await requireUser(event);

  const parsed = bodySchema.safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid body');

  const { language, text } = parsed.data;
  if (!isSupportedLanguage(language)) throw error(400, 'Unsupported language');

  try {
    return json(await tokenizeText(language, text));
  } catch (e) {
    throw error(502, `NLP service: ${e instanceof Error ? e.message : String(e)}`);
  }
};
