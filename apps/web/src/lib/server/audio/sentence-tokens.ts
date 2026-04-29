/**
 * Sentence-grouped token loader for the alignment editor (T-9.5).
 *
 * The editor walks the chapter one sentence at a time and lets the
 * owner press-and-hold to mark each sentence's start/end ms during
 * playback. The grouping comes off `text_tokens.sentence_idx`,
 * written by the NLP worker (T-2.6).
 */
import { asc, eq } from 'drizzle-orm';

import type { SentenceTokens } from '../../audio/sentence-tokens.js';
import { db, schema } from '../db/index.js';
import type { TextToken } from '../db/schema.js';
export { interpolateSentenceMarks } from '../../audio/sentence-tokens.js';
export type { SentenceMark, SentenceTokens } from '../../audio/sentence-tokens.js';

export async function loadSentenceTokensForAudio(
  audioFileId: string,
): Promise<SentenceTokens[]> {
  const [audio] = (await db
    .select({
      textId: schema.audioFiles.textId,
      chapterId: schema.audioFiles.chapterId,
    })
    .from(schema.audioFiles)
    .where(eq(schema.audioFiles.id, audioFileId))
    .limit(1)) as Array<{ textId: string; chapterId: string | null }>;
  if (!audio) return [];

  // For chapter-bound audio we walk just that chapter's tokens; for
  // whole-text audio we'd have to walk every chapter — out of scope
  // for the manual editor (whole-text audio is rare; the importer
  // path is the realistic surface for that).
  if (!audio.chapterId) return [];

  const tokens = (await db
    .select()
    .from(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, audio.chapterId))
    .orderBy(asc(schema.textTokens.idx))) as TextToken[];

  // Group on sentence_idx, preserving reading order.
  const out: SentenceTokens[] = [];
  let cur: SentenceTokens | null = null;
  for (const t of tokens) {
    if (!cur || cur.sentenceIdx !== t.sentenceIdx) {
      cur = { sentenceIdx: t.sentenceIdx, tokens: [] };
      out.push(cur);
    }
    cur.tokens.push({ id: t.id, surface: t.surface, isWord: t.isWord });
  }
  return out;
}
