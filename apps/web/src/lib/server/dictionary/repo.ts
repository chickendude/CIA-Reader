/**
 * Narrow repository port for the dictionary import runner (T-3.1).
 *
 * The runner logic (idempotency, curator-locked skip, translation
 * dedupe) is pure: it doesn't know whether it's talking to Postgres
 * or an in-memory Map. The only DB-shaped concept it depends on is
 * this interface. Production wires `DrizzleDictionaryRepo`; unit
 * tests wire `InMemoryDictionaryRepo` from `./test-support.ts`.
 *
 * Keeping the port this small means:
 * - runner tests don't need a real DB, a testcontainer, or a mock
 *   of Drizzle's fluent builder (which is notoriously painful);
 * - adding a new importer doesn't require touching this file at all;
 * - swapping storage backends later (e.g. a read-through cache for
 *   T-6.8 bulk reprocess) is one implementation, not a rewrite.
 */
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
   * T-3.14: who kicked off this run from the admin sources page.
   * Null for CLI imports (`pnpm dictionary:import`) — the column
   * stays nullable in the schema.
   */
  triggeredByUserId?: string | null;
  /**
   * T-3.14: 'succeeded' (default) or 'failed'. The runner only emits
   * 'succeeded' itself; the admin job wrapper writes a 'failed' row
   * when the iterator throws so the page can show the error.
   */
  status?: 'succeeded' | 'failed';
  /** T-3.14: short error message when status='failed'. */
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

  insertForm(payload: FormUpsertPayload): Promise<void>;

  recordImportRun(audit: ImportRunAudit): Promise<void>;
}
