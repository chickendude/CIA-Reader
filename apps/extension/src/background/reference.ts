/**
 * External reference dictionaries (Elhuyar eu-es/eu-en + Euskaltzaindia).
 *
 * Firefox won't let the background scrape elhuyar.eus directly (cross-origin,
 * no CORS), so we go through the backend's server-side scrapers — the same ones
 * app/web uses. Results are cached in IndexedDB (30 days) so a repeated word
 * resolves instantly without even a backend round-trip; the backend also caches
 * server-side, so the upstream sites are barely touched.
 */
import type { ReferenceEntry, ReferenceSource } from '../shared/lookup';
import { api } from './api-client';
import { idbKvStore, type KvStore } from './idb';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ALL_SOURCES: ReferenceSource[] = ['elhuyar_es', 'elhuyar_en', 'euskaltzaindia'];

const cacheKey = (language: string, word: string) =>
  `ref:${language}:${word.toLocaleLowerCase()}`;

type RefClient = { getJson<T>(path: string): Promise<T> };
type Cached = { at: number; results: ReferenceEntry[] };

export class ReferenceCache {
  constructor(
    private store: KvStore = idbKvStore(),
    private client: RefClient = api,
  ) {}

  async lookup(language: string, word: string): Promise<ReferenceEntry[]> {
    const w = word.trim();
    if (!w || language !== 'eu') return [];

    const key = cacheKey(language, w);
    const cached = await this.store.get<Cached>(key);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.results;

    const params = new URLSearchParams({ word: w, sources: ALL_SOURCES.join(',') });
    const res = await this.client.getJson<{ results: ReferenceEntry[] }>(
      `/api/v1/dictionary/${language}/reference?${params.toString()}`,
    );
    await this.store.set(key, { at: Date.now(), results: res.results });
    return res.results;
  }
}

export const referenceCache = new ReferenceCache();
