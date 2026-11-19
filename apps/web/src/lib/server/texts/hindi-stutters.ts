import type { HindiAnalysis, NlpToken } from '../nlp-client.js';
import type { RenderedToken } from './tokens.js';

export interface HindiStutter {
  start: number;
  surface: string;
  first: number;
  word: number;
  status: 'auto' | 'pending' | 'confirmed' | 'separate';
}

export function chapterStutters(stats?: Record<string, unknown>): HindiStutter[] {
  return (stats?.stutters ?? []) as HindiStutter[];
}

type Word = { idx: number; surface: string; is_word: boolean; is_oov: boolean };
type Occurrence = { start_idx: number; end_idx: number; lemma_id: string };
type Stats = { source_words: number; unresolved_occurrences: number; [key: string]: unknown };

const hyphen = /^[-‐‑]$/u;
const normalized = (word: string) => word.replace(/\u200c|\u200d|\ufeff/gu, '').normalize('NFC');

/** Indices include whitespace. Only directly joined words can form a restart. */
export function detectStutters(
  tokens: Word[],
  occurrences: Occurrence[],
  previous: HindiStutter[],
) {
  const readings = new Map<number, Set<string>>();
  const compoundParts = new Set<number>();
  for (const o of occurrences) {
    if (o.end_idx > o.start_idx + 1) {
      for (let i = o.start_idx; i < o.end_idx; i++) compoundParts.add(i);
    } else {
      const ids = readings.get(o.start_idx) ?? new Set<string>();
      ids.add(o.lemma_id);
      readings.set(o.start_idx, ids);
    }
  }
  const reviewed = new Map(
    previous
      .filter((s) => s.status === 'confirmed' || s.status === 'separate')
      .map((s) => [s.start, s]),
  );
  const spans: HindiStutter[] = [];
  let offset = 0;
  for (let first = 0; first < tokens.length; ) {
    const token = tokens[first]!;
    let last = first;
    while (
      token.is_word &&
      hyphen.test(tokens[last + 1]?.surface ?? '') &&
      tokens[last + 2]?.is_word
    )
      last += 2;
    if (first === last) {
      offset += [...token.surface].length;
      first++;
      continue;
    }
    const parts = tokens.slice(first, last + 1);
    const start = offset;
    const surface = parts.map((t) => t.surface).join('');
    offset += [...surface].length;
    first = last + 1;
    const word = tokens[last]!;
    const fragment = normalized(token.surface);
    const target = normalized(word.surface);
    const letters = fragment.match(/\p{L}/gu)?.length ?? 0;
    if (
      letters < 1 ||
      letters > 2 ||
      !/\p{Script=Devanagari}/u.test(fragment) ||
      target === fragment ||
      !target.startsWith(fragment) ||
      parts.slice(0, -1).some((t) => t.is_word && normalized(t.surface) !== fragment)
    )
      continue;
    const saved = reviewed.get(start);
    const ids = readings.get(token.idx);
    const sharedReading = [...(readings.get(word.idx) ?? [])].some((id) => ids?.has(id));
    let status: HindiStutter['status'];
    if (saved?.surface === surface) status = saved.status;
    else {
      if (sharedReading || parts.slice(0, -1).some((t) => compoundParts.has(t.idx))) continue;
      status = letters === 1 && !ids?.size && token.is_oov ? 'auto' : 'pending';
    }
    spans.push({ start, surface, first: token.idx, word: word.idx, status });
  }
  return spans;
}

/** Source positions stay stable for saved reader selections and word corrections. */
export function projectStutters<T extends Occurrence>(
  tokens: Word[],
  occurrences: T[],
  stats: Stats,
  spans: HindiStutter[],
  hash: string,
) {
  const prefixes = new Set<number>();
  for (const span of spans) {
    if (span.status === 'auto' || span.status === 'confirmed')
      for (let i = span.first; i < span.word; i++) prefixes.add(i);
  }
  const removed = tokens.filter((t) => t.is_word && prefixes.has(t.idx));
  const kept = occurrences.filter((o) => !prefixes.has(o.start_idx));
  const next = { ...stats, stutters: spans, stutter_text_hash: hash };
  if (removed.length) {
    next.source_words -= removed.length;
    next.unresolved_occurrences -= removed.filter((t) => t.is_oov).length;
    Object.assign(next, {
      unique_word_forms: new Set(
        tokens.filter((t) => t.is_word && !prefixes.has(t.idx)).map((t) => normalized(t.surface)),
      ).size,
      candidate_occurrences: kept.length,
      unique_entries: new Set(kept.map((o) => o.lemma_id)).size,
    });
    const excluded = { ...(stats.excluded as Record<string, number> | undefined) };
    excluded.restart = (excluded.restart ?? 0) + removed.length * 2;
    if (excluded.punctuation !== undefined) excluded.punctuation -= removed.length;
    const letters = next.source_words + (excluded.foreign ?? 0);
    Object.assign(next, {
      excluded,
      hindi_word_fraction: letters ? next.source_words / letters : null,
    });
  }
  return { prefixes, occurrences: kept, stats: next };
}

export function applyHindiStutters<T extends NlpToken>(
  tokens: T[],
  analysis: HindiAnalysis,
  previous: HindiStutter[],
  hash: string,
) {
  const found = detectStutters(tokens, analysis.occurrences, previous);
  const result = projectStutters(tokens, analysis.occurrences, analysis.stats, found, hash);
  return {
    tokens: tokens.map((t) =>
      result.prefixes.has(t.idx)
        ? { ...t, is_word: false, is_oov: false, is_ambiguous: false, candidates: [] }
        : t,
    ),
    analysis: { ...analysis, stats: result.stats, occurrences: result.occurrences },
  };
}

/** Keep the final token's identity and lexical selection for the whole printed word. */
export function joinReaderStutters(
  tokens: RenderedToken[],
  spans: HindiStutter[],
): RenderedToken[] {
  const merged = new Map(
    spans.filter((s) => s.status === 'auto' || s.status === 'confirmed').map((s) => [s.first, s]),
  );
  if (!merged.size) return tokens;
  const result: RenderedToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i]!;
    const span = merged.get(first.idx);
    if (!span) {
      result.push(first);
      continue;
    }
    const end = i + span.word - span.first;
    const word = tokens[end];
    const parts = tokens.slice(i, end + 1);
    if (word?.idx !== span.word || parts.map((t) => t.surface).join('') !== span.surface) {
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
      surface: span.surface,
      bbox,
      romanization: parts.map((t) => t.romanization ?? t.surface).join(''),
    });
    i = end;
  }
  return result;
}
