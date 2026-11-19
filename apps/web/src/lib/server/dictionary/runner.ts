/**
 * Match an imported entry by language, source and source ID. Update unlocked entries and preserve
 * a curator's edits to locked entries. Record the result of each import.
 */
import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryRepo } from './repo.js';
import type { DictionaryImportSource, ImportEntry, ImportResult } from './types.js';

export type RunImportOptions = {
  /**
   * when the admin sources page kicks off an import, the
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
