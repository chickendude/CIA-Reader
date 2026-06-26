/**
 * Sentence translation via the backend (OpenAI-backed; can't run locally), with
 * an IndexedDB cache keyed by (language, targetLanguage, text). The backend also
 * caches globally, but the local cache means a re-hover of an already-translated
 * line is instant and offline.
 */
import { api } from './api-client';
import { idbKvStore, type KvStore } from './idb';

type TranslateClient = {
  postJson<T>(path: string, body: unknown): Promise<T>;
};

const key = (language: string, target: string, text: string): string =>
  `xlate:${language}:${target}:${text.trim().toLowerCase()}`;

export class TranslationCache {
  constructor(
    private store: KvStore = idbKvStore(),
    private client: TranslateClient = api,
  ) {}

  async translate(language: string, text: string, targetLanguage: string): Promise<string> {
    const cacheKey = key(language, targetLanguage, text);
    const cached = await this.store.get<string>(cacheKey);
    if (cached) return cached;

    const res = await this.client.postJson<{ translation: string }>('/api/v1/translate-text', {
      language,
      text,
      targetLanguage,
    });
    if (res.translation) await this.store.set(cacheKey, res.translation);
    return res.translation;
  }
}

export const translationCache = new TranslationCache();
