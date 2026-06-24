/**
 * Local-first internal dictionary.
 *
 * Downloads the language's dictionary snapshot once via the backend export
 * endpoint, caches it in IndexedDB, and serves headword look-ups entirely from
 * an in-memory index — so word look-ups never hit the network after the first
 * download. The index is rebuilt from IndexedDB on demand (the background worker
 * can be torn down between uses).
 */
import type { DictionaryExport, ExportedLemma } from '../shared/api-types';
import { api } from './api-client';
import {
  buildHeadwordIndex,
  lookupHeadword,
  type HeadwordIndex,
} from './dictionary-index';
import { idbKvStore, type KvStore } from './idb';

const key = (language: string) => `dictionary:${language}`;

type DictClient = { getJson<T>(path: string): Promise<T> };

export class LocalDictionary {
  private index: HeadwordIndex | null = null;
  private loadedLanguage: string | null = null;

  constructor(
    private store: KvStore = idbKvStore(),
    private client: DictClient = api,
  ) {}

  private async download(language: string): Promise<DictionaryExport> {
    const exported = await this.client.getJson<DictionaryExport>(
      `/api/v1/dictionary/${language}/export`,
    );
    await this.store.set(key(language), exported);
    return exported;
  }

  async ensureLoaded(language: string): Promise<void> {
    if (this.index && this.loadedLanguage === language) return;
    const exported =
      (await this.store.get<DictionaryExport>(key(language))) ?? (await this.download(language));
    this.index = buildHeadwordIndex(exported);
    this.loadedLanguage = language;
  }

  /** Force a fresh download; returns the lemma count now cached. */
  async refresh(language: string): Promise<number> {
    const exported = await this.download(language);
    this.index = buildHeadwordIndex(exported);
    this.loadedLanguage = language;
    return exported.count;
  }

  async lookup(language: string, word: string): Promise<ExportedLemma[]> {
    await this.ensureLoaded(language);
    return this.index ? lookupHeadword(this.index, word) : [];
  }

  async status(language: string): Promise<{ ready: boolean; count: number }> {
    const exported = await this.store.get<DictionaryExport>(key(language));
    return { ready: Boolean(exported), count: exported?.count ?? 0 };
  }
}

export const localDictionary = new LocalDictionary();
