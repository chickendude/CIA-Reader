import type { ParseResponse } from '../shared/api-types';
import { api } from './api-client';
import { idbKvStore, type KvStore } from './idb';
import { pickLemmas } from './parse-tokens';

const key = (language: string, surface: string) =>
  `dictionary-forms:${language}:${surface.toLocaleLowerCase()}`;

type ParseClient = { postJson<T>(path: string, body: unknown): Promise<T> };

export class ParseCache {
  constructor(
    private store: KvStore = idbKvStore(),
    private client: ParseClient = api,
  ) {}

  /** Use the current dictionary when online and the last saved match when offline. */
  async resolveLemmas(language: string, surface: string): Promise<string[]> {
    const word = surface.trim();
    if (!word) return [];

    const cacheKey = key(language, word);

    try {
      const parse = await this.client.postJson<ParseResponse>('/api/v1/parse', {
        language,
        text: word,
      });
      const lemmas = pickLemmas(parse);
      await this.store.set(cacheKey, lemmas);
      return lemmas;
    } catch (e) {
      console.warn('[primeran-miner] dictionary lookup failed', e);
      return (await this.store.get<string[]>(cacheKey)) ?? [];
    }
  }
}

export const parseCache = new ParseCache();
