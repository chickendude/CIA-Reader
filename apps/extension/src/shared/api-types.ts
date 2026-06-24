/**
 * Wire shapes returned by the CIA Reader backend endpoints the extension calls.
 * Mirrors `apps/web` (`/api/v1/parse` and `/api/v1/dictionary/:lang/export`).
 */

/** One lemma candidate from the NLP service (snake_case on the wire). */
export type ParseCandidateWire = {
  lemma: string;
  pos: string;
  score: number;
  features: Record<string, string>;
};

export type ParseTokenWire = {
  idx: number;
  surface: string;
  is_word: boolean;
  candidates: ParseCandidateWire[];
  is_ambiguous: boolean;
  is_oov: boolean;
  romanization: string | null;
};

export type ParseResponse = {
  language: string;
  tokens: ParseTokenWire[];
};

export type ExportedTranslation = {
  body: string;
  lang: string;
  kind: 'official' | 'community';
};

export type ExportedLemma = {
  id: string;
  headword: string;
  pos: string;
  gloss: string | null;
  freq: number | null;
  translations: ExportedTranslation[];
};

export type DictionaryExport = {
  language: string;
  count: number;
  lemmas: ExportedLemma[];
};
