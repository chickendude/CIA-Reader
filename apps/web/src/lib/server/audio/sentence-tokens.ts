/**
 * Sentence-grouped token loader for the alignment editor (T-9.5).
 *
 * The editor walks the chapter one sentence at a time and lets the
 * owner press-and-hold to mark each sentence's start/end ms during
 * playback. The grouping comes off `text_tokens.sentence_idx`,
 * written by the NLP worker (T-2.6).
 */
import { asc, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { TextToken } from '../db/schema.js';

export type SentenceTokens = {
  sentenceIdx: number;
  tokens: Array<{ id: string; surface: string; isWord: boolean }>;
};

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

export type SentenceMark = {
  sentenceIdx: number;
  startMs: number;
  endMs: number;
};

/**
 * Linearly interpolate per-token timing across each sentence's
 * marked (startMs, endMs) range. Each word in a sentence gets an
 * equal slice; non-word tokens (punctuation / whitespace) are
 * skipped — the alignment table is per-token but the highlighter
 * only paints `isWord` spans anyway, so emitting rows for
 * punctuation just bloats the table.
 *
 * Pure function — unit-tested without the DB.
 */
export function interpolateSentenceMarks(
  sentences: SentenceTokens[],
  marks: SentenceMark[],
): Array<{ tokenId: string; startMs: number; endMs: number }> {
  const marksBySentence = new Map<number, SentenceMark>();
  for (const m of marks) marksBySentence.set(m.sentenceIdx, m);
  const out: Array<{ tokenId: string; startMs: number; endMs: number }> = [];
  for (const s of sentences) {
    const mark = marksBySentence.get(s.sentenceIdx);
    if (!mark) continue;
    const wordTokens = s.tokens.filter((t) => t.isWord);
    if (wordTokens.length === 0) continue;
    const span = Math.max(0, mark.endMs - mark.startMs);
    const slice = span / wordTokens.length;
    for (let i = 0; i < wordTokens.length; i++) {
      const start = Math.round(mark.startMs + slice * i);
      const end = Math.round(mark.startMs + slice * (i + 1));
      out.push({ tokenId: wordTokens[i]!.id, startMs: start, endMs: end });
    }
  }
  return out;
}
