export const SENTENCE_END_RE = /[।॥.!?…]/u;

type Token = { idx: number; surface: string; isWord?: boolean };

export function wordContext(tokens: readonly Token[], idx: number) {
  const position = tokens.findIndex((t) => t.idx === idx);
  if (position < 0) return;
  const paragraphBreak = (t: Token) => !t.isWord && /\n\s*\n/u.test(t.surface);
  let start = position;
  let end = position;
  while (start > 0) {
    const previous = tokens[start - 1]!;
    if (paragraphBreak(previous) || SENTENCE_END_RE.test(previous.surface)) break;
    start--;
  }
  while (end + 1 < tokens.length && !SENTENCE_END_RE.test(tokens[end]!.surface)) {
    if (paragraphBreak(tokens[end + 1]!)) break;
    end++;
  }
  return {
    before: tokens
      .slice(start, position)
      .map((t) => t.surface)
      .join(''),
    match: tokens[position]!.surface,
    after: tokens
      .slice(position + 1, end + 1)
      .map((t) => t.surface)
      .join(''),
  };
}
