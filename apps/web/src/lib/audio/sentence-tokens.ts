export type SentenceTokens = {
  sentenceIdx: number;
  tokens: Array<{ id: string; surface: string; isWord: boolean }>;
};

export type SentenceMark = {
  sentenceIdx: number;
  startMs: number;
  endMs: number;
};

/**
 * Linearly interpolate per-token timing across each sentence's
 * marked (startMs, endMs) range.
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
