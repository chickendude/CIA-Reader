import { withReaderCandidate, type ServerToken } from './types.js';

const hyphen = /^[-‐‑]$/u;

function dictionaryReading(tokens: ServerToken[], i: number) {
  const token = tokens[i]!;
  const ends = token.dictionarySpanEnds;
  if (!ends || !token.isWord || token.ignoredHere || token.lastTokenIdx !== undefined) return;
  if (tokens[i - 2]?.isWord && hyphen.test(tokens[i - 1]!.surface)) return;

  const primaryEnd = token.lemmaId ? ends[token.lemmaId] : undefined;
  const fixed = token.correctedByViewer || token.selectedBy === 'human';
  if (fixed && !primaryEnd) return;

  // Prefer a selected phrase, then the longest complete dictionary match.
  const possibleEnds = new Set<number>();
  if (primaryEnd && (fixed || token.selectedBy)) possibleEnds.add(primaryEnd);
  if (!fixed) {
    const alternatives = token.candidates.map(c => ends[c.lemmaId]);
    if (primaryEnd) alternatives.push(primaryEnd);
    for (const end of alternatives.filter((n): n is number => n !== undefined).sort((a, b) => b - a))
      possibleEnds.add(end);
  }
  for (const end of possibleEnds) {
    const last = i + end - token.idx - 1;
    const lastWord = tokens[last];
    if (last <= i || lastWord?.idx !== end - 1 || !lastWord.isWord) continue;
    if (hyphen.test(tokens[last + 1]?.surface ?? '') && tokens[last + 2]?.isWord) continue;
    const parts = tokens.slice(i + 1, last + 1);
    const blocked = parts.some(t => {
      if (t.lastTokenIdx !== undefined || t.correctedByViewer || t.ignoredHere) return true;
      if (t.selectedBy === 'human' || t.candidates.some(c => c.selectedBy === 'human')) return true;
      return !t.isWord && (t.status === 'ignored' || !/^(?:\s+|[-‐‑])$/u.test(t.surface));
    });
    if (blocked) continue;

    let reading = token;
    if (end !== primaryEnd) {
      const chosen = token.candidates.find(c => ends[c.lemmaId] === end);
      if (!chosen) continue;
      reading = withReaderCandidate(token, chosen);
    }
    // A joined token represents the whole phrase. Its word-level readings belong to other spans.
    if (reading.candidates.some(c => c.selectedBy === 'human' && ends[c.lemmaId] !== end)) continue;
    const candidates = reading.candidates.filter(c => ends[c.lemmaId] === end);
    return { end, reading: { ...reading, candidates, isAmbiguous: candidates.length > 0 } };
  }
}

export function joinDictionaryEntries(tokens: ServerToken[]) {
  const spans = [];
  const readings = tokens.slice();
  for (const [i, token] of tokens.entries()) {
    const match = dictionaryReading(tokens, i);
    if (!match) continue;
    readings[i] = match.reading;
    spans.push({ first: token.idx, last: match.end - 1, anchor: token.idx });
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
