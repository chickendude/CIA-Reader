import type { HindiAnalysis, NlpToken } from '../nlp-client';
import type { HindiMerge } from '$lib/dictionary/hindi-merge';
import type { TextToken } from '../db/schema';
import type { HindiStutter } from './hindi-stutters';

type Word = Pick<NlpToken, 'idx' | 'surface' | 'is_word' | 'is_oov'>;
type Occurrence = HindiAnalysis['occurrences'][number];

export type FragmentReading = Pick<
  TextToken,
  | 'idx'
  | 'surface'
  | 'isWord'
  | 'isOov'
  | 'isAmbiguous'
  | 'lemmaId'
  | 'lemmaCandidates'
  | 'features'
>;

export function fragmentReading(t: NlpToken): FragmentReading {
  return {
    idx: t.idx,
    surface: t.surface,
    isWord: t.is_word,
    isOov: t.is_oov,
    isAmbiguous: t.is_ambiguous,
    lemmaId: t.candidates[0]?.dictionary_id ?? null,
    lemmaCandidates: t.candidates.map((c) => ({
      lemmaId: c.dictionary_id ?? null,
      features: c.features,
      score: 1,
    })),
    features: t.candidates[0]?.features ?? {},
  };
}

export type MergeOriginal = {
  tokens: FragmentReading[];
  occurrences: Occurrence[];
  stutters: HindiStutter[];
};
export function mergeOriginals(stats: Record<string, unknown>) {
  return (stats.syllable_merge_originals ?? {}) as Record<string, MergeOriginal>;
}

/** Keep earlier stutter decisions available while a syllable merge covers their source span. */
export function coveredStutters(stats: Record<string, unknown>) {
  return Object.values(mergeOriginals(stats)).flatMap(original => original.stutters);
}

export function originalForMerge(
  m: MergeSelection,
  tokens: FragmentReading[],
  occurrences: Occurrence[],
  stutters: HindiStutter[],
): MergeOriginal {
  return {
    tokens: tokens.filter((t) => m.first <= t.idx && t.idx <= m.last),
    occurrences: occurrences.filter((o) => m.first <= o.start_idx && o.start_idx <= m.last),
    stutters: stutters.filter((s) => s.first <= m.last && m.first <= s.word),
  };
}

export function storedHindiMerges(stats?: Record<string, unknown>) {
  return (stats?.syllable_merges ?? []) as HindiMerge[];
}

export type MergeSelection = Pick<HindiMerge, 'first' | 'last' | 'lemmaId' | 'surface'>;

export function sameMerge(a: MergeSelection, b: MergeSelection) {
  return (
    a.first === b.first && a.last === b.last && a.lemmaId === b.lemmaId && a.surface === b.surface
  );
}

/** A merged reading keeps the first token ID. Every source token keeps its spelling and index. */
export function projectHindiMerges<T extends Word>(
  tokens: T[],
  occurrences: Occurrence[],
  stats: HindiAnalysis['stats'],
  merges: HindiMerge[],
  reading: (token: T) => FragmentReading,
) {
  if (!merges.length) return { tokens, occurrences, stats };
  const all = [...storedHindiMerges(stats), ...merges];
  const originals = { ...mergeOriginals(stats) };
  const stutters = (stats.stutters ?? []) as HindiStutter[];
  const readings = tokens
    .filter((t) => merges.some((m) => m.first <= t.idx && t.idx <= m.last))
    .map(reading);
  for (const m of merges) originals[m.first] = originalForMerge(m, readings, occurrences, stutters);
  const parts = new Map<number, HindiMerge>();
  for (const m of merges) for (let i = m.first; i <= m.last; i++) parts.set(i, m);
  const kept = occurrences.filter((o) => !parts.has(o.start_idx));
  let offset = 0;
  const projected = tokens.map((t) => {
    const start = offset;
    offset += [...t.surface].length;
    const m = parts.get(t.idx);
    if (!m) return t;
    const first = t.idx === m.first;
    if (first)
      kept.push({
        start_idx: m.first,
        end_idx: m.last + 1,
        source_start: start,
        source_end: start + [...m.surface].length,
        lemma_id: m.lemmaId,
        rules: ['syllable-merge'],
      });
    return {
      ...t,
      is_word: first,
      is_oov: false,
      is_ambiguous: false,
      candidates: first
        ? [{ dictionary_id: m.lemmaId, lemma: m.headword, pos: m.pos, score: 1, features: {} }]
        : [],
    };
  });
  return {
    tokens: projected,
    occurrences: kept,
    stats: hindiMergeStats(
      projected,
      kept,
      {
        ...stats,
        syllable_merge_originals: originals,
        stutters: stutters.filter((s) => !all.some((m) => m.first <= s.word && s.first <= m.last)),
      },
      all,
    ),
  };
}

export function hindiMergeStats(
  tokens: Word[],
  occurrences: Occurrence[],
  stats: Record<string, unknown>,
  merges: HindiMerge[],
) {
  const heads = new Map(merges.map((m) => [m.first, m.headword]));
  const words = tokens.filter((t) => t.is_word);
  const excluded = stats.excluded as Record<string, number> | undefined;
  const letters = words.length + (excluded?.foreign ?? 0);
  return {
    ...stats,
    syllable_merges: merges,
    source_words: words.length,
    unresolved_occurrences: words.filter((t) => t.is_oov).length,
    unique_word_forms: new Set(words.map((t) => (heads.get(t.idx) ?? t.surface).normalize('NFC')))
      .size,
    hindi_word_fraction: letters ? words.length / letters : null,
    candidate_occurrences: occurrences.length,
    unique_entries: new Set(occurrences.map((o) => o.lemma_id)).size,
  };
}
