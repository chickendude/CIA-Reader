/**
 * Dictionary import runner (T-3.1).
 *
 * Pure, storage-agnostic orchestration over a `DictionaryRepo`. For
 * each source entry:
 *
 * 1. Look up the existing lemma by (language, source, source_id).
 * 2. If it exists and `curator_locked` is set, bump the skipped
 *    counter and move on — the curator's edit is sacred, and the
 *    only way to override that is T-3.7's "unlock" control.
 * 3. If it exists and is NOT locked, update the upstream-sourced
 *    fields.
 * 4. Otherwise, insert.
 * 5. Upsert each translation under (lemma_id, source, source_id).
 * 6. Insert any surface/form payloads the importer produced — forms
 *    are append-only at MVP so we don't dedupe.
 *
 * The runner returns an aggregate `ImportResult` the caller can log,
 * test against, or ship to `dictionary_imports` via
 * `repo.recordImportRun`. The runner calls `recordImportRun` itself so
 * every successful import leaves an audit row regardless of caller.
 */
import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryRepo } from './repo.js';
import type { DictionaryImportSource, ImportEntry, ImportResult } from './types.js';

export type RunImportOptions = {
  /**
   * T-3.14: when the admin sources page kicks off an import, the
   * triggering user is recorded on the `dictionary_imports` audit row.
   * CLI runs (`pnpm dictionary:import`) leave this undefined.
   */
  triggeredByUserId?: string | null;
};

export async function runDictionaryImport(
  repo: DictionaryRepo,
  source: DictionaryImportSource,
  opts: RunImportOptions = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    sourceName: source.name,
    language: source.language,
    lemmasCreated: 0,
    lemmasUpdated: 0,
    lemmasSkippedCuratorLocked: 0,
    translationsCreated: 0,
    translationsUpdated: 0,
    formsCreated: 0,
  };

  const entries = source.entries();
  for await (const entry of toAsyncIterable(entries)) {
    await importEntry(repo, source, entry, result);
  }

  await repo.recordImportRun({
    sourceName: result.sourceName,
    language: result.language,
    lemmasCreated: result.lemmasCreated,
    lemmasUpdated: result.lemmasUpdated,
    lemmasSkippedCuratorLocked: result.lemmasSkippedCuratorLocked,
    translationsCreated: result.translationsCreated,
    translationsUpdated: result.translationsUpdated,
    triggeredByUserId: opts.triggeredByUserId ?? null,
    status: 'succeeded',
  });

  return result;
}

async function importEntry(
  repo: DictionaryRepo,
  source: DictionaryImportSource,
  entry: ImportEntry,
  result: ImportResult,
): Promise<void> {
  const lemmaPayload = {
    language: source.language as LanguageCode,
    headword: entry.headword,
    pos: entry.pos,
    script: entry.script,
    glossDefault: entry.glossDefault,
    frequencyRank: entry.frequencyRank,
    source: 'official_dictionary' as const,
    sourceAttribution: source.sourceAttribution,
    sourceId: entry.sourceId,
  };

  const existing = await repo.findLemmaBySource({
    language: source.language as LanguageCode,
    source: 'official_dictionary',
    sourceId: entry.sourceId,
  });

  let lemmaId: string;
  if (existing && existing.curatorLocked) {
    result.lemmasSkippedCuratorLocked += 1;
    return;
  }
  if (existing) {
    const updated = await repo.updateLemmaFromSource(existing.id, lemmaPayload);
    lemmaId = updated.id;
    result.lemmasUpdated += 1;
  } else {
    const inserted = await repo.insertLemma(lemmaPayload);
    lemmaId = inserted.id;
    result.lemmasCreated += 1;
  }

  for (const translation of entry.translations) {
    const payload = {
      lemmaId,
      source: 'official_dictionary' as const,
      body: translation.body,
      targetLanguage: translation.targetLanguage ?? 'en',
      sourceAttribution: translation.sourceAttribution ?? source.sourceAttribution,
      sourceId: translation.sourceId,
    };
    const existingTranslation = await repo.findTranslation(
      lemmaId,
      'official_dictionary',
      translation.sourceId,
    );
    if (existingTranslation) {
      await repo.updateTranslation(existingTranslation.id, payload);
      result.translationsUpdated += 1;
    } else {
      await repo.insertTranslation(payload);
      result.translationsCreated += 1;
    }
  }

  for (const form of entry.forms ?? []) {
    await repo.insertForm({
      lemmaId,
      surface: form.surface,
      features: form.features ?? {},
      romanization: form.romanization,
    });
    result.formsCreated += 1;
  }
}

function toAsyncIterable<T>(source: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in (source as object)) {
    return source as AsyncIterable<T>;
  }
  return (async function* () {
    for (const value of source as Iterable<T>) {
      yield value;
    }
  })();
}
