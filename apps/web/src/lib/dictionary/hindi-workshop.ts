export const partsOfSpeech = {
  NOUN: 'noun',
  PROPN: 'proper noun',
  VERB: 'verb',
  AUX: 'auxiliary verb',
  ADJ: 'adjective',
  ADV: 'adverb',
  ADP: 'adposition',
  CCONJ: 'coordinating conjunction',
  SCONJ: 'subordinating conjunction',
  DET: 'determiner',
  INTJ: 'interjection',
  NUM: 'numeral',
  PART: 'particle',
  PRON: 'pronoun',
  VBASE: 'verbal base',
  ONOM: 'onomatopoeia',
};

export type Slot = {
  id: string;
  label: string;
  forms: string[];
  include: boolean;
  applicability: 'applicable' | 'unknown' | 'not_applicable';
};
export type Inventory = {
  version: string;
  lemma: string;
  pos: string;
  paradigm: string;
  slots: Slot[];
};
export type Excerpt = { url: string; original: string; english: string };
export type Draft = {
  id: string | null;
  version: string;
  lemma: string;
  pos: string;
  meaning: string;
  paradigm: string;
  alternatives: string[];
  other: string[];
  excluded: string[];
  loan: boolean;
  inventory: Inventory | null;
  excerpts: Excerpt[];
};
export function emptyDraft(lemma = '', pos = 'NOUN'): Draft {
  return {
    id: null,
    version: '',
    lemma,
    pos,
    meaning: '',
    paradigm: 'invariant',
    alternatives: [],
    other: [],
    excluded: [],
    loan: false,
    inventory: null,
    excerpts: [],
  };
}
export type Match = { id: string; lemma: string; pos: string; meaning: string };
export type ReviewItem = {
  id: string | null;
  pos: string | null;
  word: string;
  kind: string;
  count: number;
  samples: { book: string; chapter: number; token: number; context: string; count: number }[];
};
export type Reference = { provider: string; label: string; source_url: string };

export type WorkshopReport = {
  fingerprint: string;
  rows: {
    id: string | null;
    target?: string;
    lemma: string;
    pos: string;
    target_lemma?: string;
    recommendation?: string;
    reason: string;
    blocked?: string;
    state: string;
  }[];
};
