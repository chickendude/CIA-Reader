/** Storage operations used by dictionary imports. Tests can supply an in-memory dictionary. */
import type { LanguageCode } from '@ciareader/shared-types';

import type { Lemma, Translation } from '../db/schema.js';

export type LemmaLookupKey = {
  language: LanguageCode;
  source: Lemma['source'];
  sourceId: string;
};

export type LemmaUpsertPayload = {
  language: LanguageCode;
  headword: string;
  pos: string;
  script: string;
  glossDefault?: string;
  frequencyRank?: number;
  source: Lemma['source'];
  sourceAttribution: string;
  sourceId: string;
};

export type TranslationUpsertPayload = {
  lemmaId: string;
  source: Translation['source'];
  body: string;
  targetLanguage: string;
  sourceAttribution?: string;
  sourceId: string;
};

export type FormUpsertPayload = {
  lemmaId: string;
  surface: string;
  features: Record<string, string>;
  romanization?: string;
};

type SavedForm = Pick<FormUpsertPayload, 'surface' | 'features'>;

export function missingImportForms(saved: SavedForm[], incoming: FormUpsertPayload[]): FormUpsertPayload[] {
  const key = (f: SavedForm) => JSON.stringify([f.surface, Object.entries(f.features).sort()]);
  const seen = new Set(saved.map(key));
  const spellings = new Set(saved.map((f) => f.surface));
  return incoming.filter((form) => {
    const id = key(form);
    if (seen.has(id) || (!Object.keys(form.features).length && spellings.has(form.surface))) return false;
    seen.add(id);
    spellings.add(form.surface);
    return true;
  });
}

export type ImportRunAudit = {
  sourceName: string;
  language: LanguageCode;
  lemmasCreated: number;
  lemmasUpdated: number;
  lemmasSkippedCuratorLocked: number;
  translationsCreated: number;
  translationsUpdated: number;
  notes?: string;
  /**
   * who kicked off this run from the admin sources page.
   * Null for CLI imports (`pnpm dictionary:import`) — the column
   * stays nullable in the schema.
   */
  triggeredByUserId?: string | null;
  /**
   * 'succeeded' (default) or 'failed'. The runner only emits
   * 'succeeded' itself; the admin job wrapper writes a 'failed' row
   * when the iterator throws so the page can show the error.
   */
  status?: 'succeeded' | 'failed';
  /** short error message when status='failed'. */
  errorMessage?: string | null;
};

/**
 * The narrow surface the runner needs. All methods are async because
 * the production implementation is. In-memory fakes resolve
 * synchronously under the hood — that's fine, `await` on a non-promise
 * is a no-op.
 */
export interface DictionaryRepo {
  findLemmaBySource(key: LemmaLookupKey): Promise<Lemma | null>;
  insertLemma(payload: LemmaUpsertPayload): Promise<Lemma>;
  /**
   * Update an existing lemma's upstream-sourced fields. MUST NOT be
   * called for a row where `curator_locked = true` — the runner
   * enforces that before calling.
   */
  updateLemmaFromSource(id: string, payload: LemmaUpsertPayload): Promise<Lemma>;

  findTranslation(
    lemmaId: string,
    source: Translation['source'],
    sourceId: string,
  ): Promise<Translation | null>;
  insertTranslation(payload: TranslationUpsertPayload): Promise<Translation>;
  updateTranslation(id: string, payload: TranslationUpsertPayload): Promise<Translation>;

  insertMissingForms(lemmaId: string, forms: FormUpsertPayload[]): Promise<number>;

  recordImportRun(audit: ImportRunAudit): Promise<void>;
}
