/**
 * Sentence reconstruction from stored tokens.
 *
 * `text_tokens.sentence_idx` isn't populated yet (always 0), so a "sentence"
 * is derived by scanning a chapter's tokens out to sentence-ending punctuation
 * — but never across a paragraph break, so a heading or chapter title never
 * gets glued onto the following sentence. Used to capture the sentence a word
 * was mined from (Anki export) and to feed the OpenAI sentence translator.
 */
import { asc, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';

import { wordContext } from '$lib/dictionary/word-context';
export { SENTENCE_END_RE } from '$lib/dictionary/word-context';

type MiniToken = { idx: number; surface: string; isWord?: boolean };

export function sentenceFromTokens(tokens: MiniToken[], tokenIdx: number): string {
  const context = wordContext(
    [...tokens].sort((a, b) => a.idx - b.idx),
    tokenIdx,
  );
  return context
    ? (context.before + context.match + context.after).replace(/\s+/g, ' ').trim()
    : '';
}

/** Load a chapter's tokens and reconstruct the sentence around `tokenIdx`. */
export async function sentenceAround(chapterId: string, tokenIdx: number): Promise<string> {
  const rows = await db
    .select({
      idx: schema.textTokens.idx,
      surface: schema.textTokens.surface,
      isWord: schema.textTokens.isWord,
    })
    .from(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, chapterId))
    .orderBy(asc(schema.textTokens.idx));
  return sentenceFromTokens(rows, tokenIdx);
}
