import type { ServerToken } from './types.js';

export function joinDictionaryEntries(tokens: ServerToken[]) {
  const spans = [];
  for (const [i, token] of tokens.entries()) {
    const end = token.lemmaId && token.dictionarySpanEnds?.[token.lemmaId];
    if (
      !end ||
      !token.isWord ||
      token.features.Compound !== 'Yes' ||
      token.lastTokenIdx !== undefined
    )
      continue;
    const parts = tokens.slice(i + 1, i + end - token.idx);
    if (
      parts.at(-1)?.idx !== end - 1 ||
      parts.some(
        (t) =>
          t.lastTokenIdx !== undefined ||
          t.correctedByViewer ||
          t.selectedBy ||
          (t.status === 'ignored' && !t.isWord),
      )
    )
      continue;
    spans.push({ first: token.idx, last: end - 1, anchor: token.idx });
  }
  return joinReaderSpans(tokens, spans);
}

export function joinReaderSpans<T extends ServerToken>(
  tokens: T[],
  spans: { first: number; last: number; anchor: number; surface?: string }[],
) {
  const merged = new Map(spans.map((s) => [s.first, s]));
  if (!merged.size) return tokens;
  const result: T[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i]!;
    const span = merged.get(first.idx);
    if (!span) {
      result.push(first);
      continue;
    }
    const end = i + span.last - span.first;
    const word = tokens[i + span.anchor - span.first];
    const parts = tokens.slice(i, end + 1);
    const surface = parts.map((t) => t.surface).join('');
    if (
      word?.idx !== span.anchor ||
      tokens[end]?.idx !== span.last ||
      (span.surface !== undefined && surface !== span.surface)
    ) {
      result.push(first);
      continue;
    }
    const boxes = parts.flatMap((t) => (t.bbox ? [t.bbox] : []));
    let bbox = word.bbox;
    if (boxes.length) {
      const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
      bbox = {
        x,
        y,
        w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
        h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
      };
    }
    result.push({
      ...word,
      surface,
      lastTokenIdx: span.last,
      bbox,
      romanization: parts.map((t) => t.romanization ?? t.surface).join(''),
    });
    i = end;
  }
  return result;
}
