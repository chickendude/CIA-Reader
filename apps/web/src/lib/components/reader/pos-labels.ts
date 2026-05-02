/**
 * Universal-Dependencies part-of-speech abbreviations + full names.
 *
 * The NLP pipeline tags every lemma with a UD POS string like
 * `NOUN` / `VERB` / `PROPN`. The reader's PosPill renders a short
 * form (e.g. "n", "v", "prop") with the full name in a hover
 * tooltip; the table below is the single source of truth for that
 * mapping so the abbreviation stays consistent everywhere.
 *
 * Unknown tags fall through to a lowercased copy of the tag itself
 * — better to render a non-noisy "x" than crash on a value the
 * worker added but we haven't registered yet.
 */
export type PosLabel = {
  abbr: string;
  fullName: string;
};

const POS_LABELS: Readonly<Record<string, PosLabel>> = Object.freeze({
  NOUN: { abbr: 'n', fullName: 'noun' },
  VERB: { abbr: 'v', fullName: 'verb' },
  ADJ: { abbr: 'adj', fullName: 'adjective' },
  ADV: { abbr: 'adv', fullName: 'adverb' },
  PRON: { abbr: 'pron', fullName: 'pronoun' },
  PROPN: { abbr: 'prop', fullName: 'proper noun' },
  ADP: { abbr: 'adp', fullName: 'adposition' },
  AUX: { abbr: 'aux', fullName: 'auxiliary' },
  CCONJ: { abbr: 'conj', fullName: 'coordinating conjunction' },
  SCONJ: { abbr: 'sconj', fullName: 'subordinating conjunction' },
  DET: { abbr: 'det', fullName: 'determiner' },
  INTJ: { abbr: 'intj', fullName: 'interjection' },
  NUM: { abbr: 'num', fullName: 'numeral' },
  PART: { abbr: 'part', fullName: 'particle' },
  SYM: { abbr: 'sym', fullName: 'symbol' },
  PUNCT: { abbr: 'punct', fullName: 'punctuation' },
  X: { abbr: 'x', fullName: 'other' },
});

function lookup(pos: string): PosLabel | null {
  if (!pos) return null;
  const key = pos.toUpperCase();
  return POS_LABELS[key] ?? null;
}

export function posAbbr(pos: string): string {
  return lookup(pos)?.abbr ?? pos.toLowerCase();
}

export function posFullName(pos: string): string {
  return lookup(pos)?.fullName ?? pos.toLowerCase();
}
