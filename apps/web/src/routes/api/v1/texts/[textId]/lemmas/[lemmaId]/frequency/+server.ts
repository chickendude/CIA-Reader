/**
 * GET /api/v1/texts/:textId/lemmas/:lemmaId/frequency
 *
 * How many times a lemma occurs across the whole book (the text's collection)
 * and within the current text. Public read — mirrors the reader's open access;
 * the reader popup uses it to show "appears N× in this book" so a learner can
 * prioritise frequent words.
 */
import { error, json } from '@sveltejs/kit';

import { lemmaBookFrequency } from '$lib/server/texts/book-frequency.js';
import type { RequestHandler } from './$types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ params }) => {
  const { textId, lemmaId } = params;
  if (!textId || !UUID_RE.test(textId)) throw error(400, 'Invalid text id');
  if (!lemmaId || !UUID_RE.test(lemmaId)) throw error(400, 'Invalid lemma id');

  const { book, text } = await lemmaBookFrequency(textId, lemmaId);
  return json({ book, text });
};
