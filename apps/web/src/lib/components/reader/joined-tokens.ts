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
    let reading = token;
    if (end !== primaryEnd) {
      const chosen = token.candidates.find(c => ends[c.lemmaId] === end);
      if (!chosen) continue;
      reading = withReaderCandidate(token, chosen);
    }
    const parts = tokens.slice(i, last + 1);
    const particle = insertedNegation(parts, reading);
    const blocked = parts.some((t, index) => {
      if (index === 0 || index === particle) return false;
      if (t.lastTokenIdx !== undefined || t.correctedByViewer || t.ignoredHere) return true;
      if (t.selectedBy === 'human' || t.candidates.some(c => c.selectedBy === 'human')) return true;
      return !t.isWord && (t.status === 'ignored' || !/^(?:\s+|[-‐‑])$/u.test(t.surface));
    });
    if (blocked) continue;

    // A joined token represents the whole phrase. Its word-level readings belong to other spans.
    if (reading.candidates.some(c => c.selectedBy === 'human' && ends[c.lemmaId] !== end)) continue;
    const candidates = reading.candidates.filter(c => ends[c.lemmaId] === end);
    return { last, parts, particle, reading: { ...reading, candidates, isAmbiguous: candidates.length > 0 } };
  }
}

function insertedNegation(parts: ServerToken[], reading: ServerToken) {
  if (reading.pos !== 'VERB' && reading.pos !== 'AUX') return -1;
  // A negative word in the headword belongs to the idiom, for example टस से मस न होना.
  if (!reading.headword || /(?:^|\s)(?:न|नहीं|ना|मत)(?:$|\s)/u.test(reading.headword)) return -1;
  return parts.findIndex((part, i) =>
    (part.surface === 'न' || part.surface === 'नहीं')
    && parts[i - 2]?.isWord && parts[i + 2]?.isWord
    && /^\s+$/u.test(parts[i - 1]!.surface) && /^\s+$/u.test(parts[i + 1]!.surface));
}

export function joinDictionaryEntries(tokens: ServerToken[]) {
  const result: ServerToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = dictionaryReading(tokens, i);
    if (!match) {
      result.push(tokens[i]!);
      continue;
    }
    const { last, parts, particle, reading } = match;
    if (particle >= 0) {
      const before = parts.slice(0, particle - 1);
      const after = parts.slice(particle + 2);
      const first = after[0]!;
      // Display the particle and its spaces verbatim. Both remaining pieces open
      // one dictionary reading anchored to the original occurrence.
      const phraseReading = joinParts(reading, [...before, parts[particle - 1]!, ...after]);
      result.push(
        { ...joinParts(reading, before), phraseReading },
        ...parts.slice(particle - 1, particle + 2),
        { ...joinParts({ ...reading, id: first.id, idx: first.idx, bbox: first.bbox }, after), phraseReading },
      );
    } else {
      result.push(joinParts(reading, parts));
    }
    i = last;
  }
  return result;
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
    if (
      word?.idx !== span.anchor ||
      tokens[end]?.idx !== span.last ||
      (span.surface !== undefined && parts.map(t => t.surface).join('') !== span.surface)
    ) {
      result.push(first);
      continue;
    }
    result.push(joinParts(word, parts));
    i = end;
  }
  return result;
}

function joinParts<T extends ServerToken>(word: T, parts: T[]): T {
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
  return {
    ...word,
    surface: parts.map(t => t.surface).join(''),
    lastTokenIdx: parts[parts.length - 1]!.idx,
    bbox,
    romanization: parts.map((t) => t.romanization ?? t.surface).join(''),
  };
}
