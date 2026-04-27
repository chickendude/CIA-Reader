/**
 * Public API of the dictionary import framework (T-3.1).
 *
 * Consumers outside `./dictionary/*` should import from here rather than
 * reaching into individual files. The in-memory repo intentionally ships
 * with this barrel so integration-style tests elsewhere (e.g. future
 * reader loaders that join against lemmas) can stand up a fake dictionary
 * without pulling Drizzle into a unit test.
 */
export { runDictionaryImport } from './runner.js';
export { DrizzleDictionaryRepo } from './drizzle-repo.js';
export { InMemoryDictionaryRepo } from './test-support.js';
export { hindiSeedSource } from './sources/hindi-seed.js';
export type { DictionaryRepo, LemmaUpsertPayload, TranslationUpsertPayload } from './repo.js';
export type {
  DictionaryImportSource,
  ImportEntry,
  ImportResult,
  TranslationPayload,
  FormPayload,
} from './types.js';
