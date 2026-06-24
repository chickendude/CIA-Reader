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

/** Sentence-ending punctuation across the supported scripts (Devanagari
 *  danda/double-danda, Western, ellipsis). Mirrors the reader's client-side
 *  `SENTENCE_END_RE` in `reader/phrase-selection.ts`. */
export const SENTENCE_END_RE = /[।॥.!?…]/u;

/** A non-word token whose surface spans a blank line is a paragraph (or
 *  heading / title) boundary. Mirrors the reader's `paragraphsOfServerTokens`
 *  in `reader/types.ts`, so a server-side sentence never crosses a boundary
 *  the reader itself renders as a separate block. */
const PARAGRAPH_BREAK_RE = /\n\s*\n/u;

type MiniToken = { idx: number; surface: string; isWord?: boolean };

function isParagraphBreak(t: MiniToken): boolean {
  return !t.isWord && PARAGRAPH_BREAK_RE.test(t.surface);
}

/**
 * Reconstruct the sentence containing `tokenIdx` from an ordered token list:
 * the run from just after the previous sentence-ender (or paragraph break)
 * through the next sentence-ender (inclusive), stopping before the next
 * paragraph break, with surfaces concatenated (gap tokens preserve spacing).
 */
export function sentenceFromTokens(tokens: MiniToken[], tokenIdx: number): string {
  const ordered = [...tokens].sort((a, b) => a.idx - b.idx);
  const pos = ordered.findIndex((t) => t.idx === tokenIdx);
  if (pos === -1) return '';

  // Walk back to the sentence start: stop just after the previous
  // sentence-ender, or at the paragraph boundary, whichever comes first.
  let start = pos;
  while (start > 0) {
    const prev = ordered[start - 1]!;
    if (isParagraphBreak(prev) || SENTENCE_END_RE.test(prev.surface)) break;
    start -= 1;
  }

  // Walk forward to the sentence-ender (inclusive), but stop before the next
  // paragraph boundary when the sentence runs right up to it (e.g. a heading
  // with no terminal punctuation).
  let end = pos;
  while (end < ordered.length - 1 && !SENTENCE_END_RE.test(ordered[end]!.surface)) {
    if (isParagraphBreak(ordered[end + 1]!)) break;
    end += 1;
  }

  return ordered
    .slice(start, end + 1)
    .map((t) => t.surface)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
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
