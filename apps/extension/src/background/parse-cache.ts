/**
 * Surface→lemma cache.
 *
 * Lemmatization needs the backend (Stanza can't run in-browser), so each surface
 * word is parsed at most once ever: the result is memoized in IndexedDB keyed by
 * (language, lowercased surface). Repeated words across an episode — and across
 * sessions — resolve locally.
 */
import type { ParseResponse } from '../shared/api-types';
import { api } from './api-client';
import { idbKvStore, type KvStore } from './idb';
import { pickLemmas } from './parse-tokens';

const key = (language: string, surface: string) =>
  `parse:${language}:${surface.toLocaleLowerCase()}`;

type ParseClient = { postJson<T>(path: string, body: unknown): Promise<T> };

export class ParseCache {
  constructor(
    private store: KvStore = idbKvStore(),
    private client: ParseClient = api,
  ) {}

  /** Dictionary-form lemmas for a single surface word (cached). */
  async resolveLemmas(language: string, surface: string): Promise<string[]> {
    const word = surface.trim();
    if (!word) return [];

    const cacheKey = key(language, word);
    const cached = await this.store.get<string[]>(cacheKey);
    if (cached) return cached;

    try {
      const parse = await this.client.postJson<ParseResponse>('/api/v1/parse', {
        language,
        text: word,
      });
      const lemmas = pickLemmas(parse);
      await this.store.set(cacheKey, lemmas);
      return lemmas;
    } catch (e) {
      // The NLP service may be down or not support this language yet. Degrade to
      // the raw surface form (the caller falls back to looking that up directly)
      // and DON'T cache, so it retries once parsing is available again.
      console.warn('[primeran-miner] parse failed; using surface form', e);
      return [];
    }
  }
}

export const parseCache = new ParseCache();
