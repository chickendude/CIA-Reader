import { withReaderCandidate, type ServerToken } from './types.js';

const hyphen = /^[-‐‑]$/u;

function hyphenatedReading(tokens: ServerToken[], i: number) {
  const token = tokens[i]!;
  const ends = token.dictionarySpanEnds;
  if (!ends || !token.isWord || token.lastTokenIdx !== undefined) return;
  if (tokens[i - 2]?.isWord && hyphen.test(tokens[i - 1]!.surface)) return;
  let last = i;
  while (hyphen.test(tokens[last + 1]?.surface ?? '') && tokens[last + 2]?.isWord) last += 2;
  if (last === i) return;

  // Only offer readings that cover the entire printed word in the joined popup.
  const end = tokens[last]!.idx + 1;
  let reading = token;
  if (!token.lemmaId || ends[token.lemmaId] !== end) {
    if (token.correctedByViewer || token.selectedBy === 'human') return;
    const match = token.candidates.find((c) => ends[c.lemmaId] === end);
    if (!match) return;
    reading = withReaderCandidate(token, match);
  }
  const candidates = reading.candidates.filter((c) => ends[c.lemmaId] === end);
  if (reading.candidates.some((c) => ends[c.lemmaId] !== end && c.selectedBy === 'human')) return;
  return { ...reading, candidates, isAmbiguous: candidates.length > 0 };
}

export function joinDictionaryEntries(tokens: ServerToken[]) {
  const spans = [];
  const readings = tokens.slice();
  for (const [i, token] of tokens.entries()) {
    const whole = hyphenatedReading(tokens, i);
    const reading = whole ?? token;
    const end = reading.lemmaId && reading.dictionarySpanEnds?.[reading.lemmaId];
    if (
      !end ||
      !token.isWord ||
      (!whole && token.features.Compound !== 'Yes') ||
      token.lastTokenIdx !== undefined
    )
      continue;
    const parts = tokens.slice(i + 1, i + end - token.idx);
    // A reader's choice for the phrase takes priority over AI suggestions on its words.
    const keepAiSelections = !whole && !reading.correctedByViewer && reading.selectedBy !== 'human';
    if (
      parts.at(-1)?.idx !== end - 1 ||
      parts.some(
        (t) =>
          t.lastTokenIdx !== undefined ||
          t.correctedByViewer ||
          t.selectedBy === 'human' ||
          (keepAiSelections && t.selectedBy === 'ai') ||
          t.ignoredHere ||
          (t.status === 'ignored' && !t.isWord),
      )
    )
      continue;
    readings[i] = reading;
    spans.push({ first: token.idx, last: end - 1, anchor: token.idx });
  }
  return spans.length ? joinReaderSpans(readings, spans) : tokens;
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
