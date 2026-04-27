/**
 * Types for the dictionary import framework (T-3.1).
 *
 * An importer is a pure producer of `ImportEntry` values drawn from an
 * upstream source (Hindi WordNet, Marathi WordNet, Molesworth, Odia
 * WordNet, etc.). The runner applies those entries against the DB with
 * idempotent upsert semantics and curator-locked respect.
 *
 * Keeping the shape this narrow means a new source (say, a future
 * Gujarati dictionary) only has to materialize an iterable of entries —
 * it never touches Drizzle, never knows what `curator_locked` means,
 * and can be developed and tested in isolation against the reference
 * runner.
 */
import type { LanguageCode } from '@ciareader/shared-types';

export type TranslationPayload = {
  /** The gloss / translation body, already cleaned of markup. */
  body: string;
  /**
   * Upstream stable id for this specific translation — usually a sense
   * id on the source side. The runner uses (lemmaSourceId + this) as
   * the idempotency key so re-running the importer updates the same
   * rows instead of duplicating them.
   */
  sourceId: string;
  /** Per-translation attribution override. Falls back to the source's default. */
  sourceAttribution?: string;
  targetLanguage?: string;
};

export type FormPayload = {
  surface: string;
  features?: Record<string, string>;
  romanization?: string;
};

export type ImportEntry = {
  /** Dictionary headword, expected to already be NFC-normalized. */
  headword: string;
  pos: string;
  script: string;
  /**
   * Stable upstream primary key. Required — it's what lets a re-import
   * update the same lemma row. Importers that can't produce one should
   * synthesize a stable hash of their headword + POS at the source layer
   * rather than leaving this undefined.
   */
  sourceId: string;
  glossDefault?: string;
  frequencyRank?: number;
  translations: TranslationPayload[];
  forms?: FormPayload[];
};

export type DictionaryImportSource = {
  /** Stable human-readable name, e.g. "hindi-wordnet". */
  name: string;
  language: LanguageCode;
  /** Default attribution — "Hindi WordNet, CFILT IIT-Bombay" etc. Copied onto every lemma/translation absent a per-entry override. */
  sourceAttribution: string;
  /** License identifier (SPDX-ish). Used for docs and the source-inventory page. */
  license: string;
  entries(): AsyncIterable<ImportEntry> | Iterable<ImportEntry>;
};

export type ImportResult = {
  sourceName: string;
  language: LanguageCode;
  lemmasCreated: number;
  lemmasUpdated: number;
  lemmasSkippedCuratorLocked: number;
  translationsCreated: number;
  translationsUpdated: number;
  formsCreated: number;
};
