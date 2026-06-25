/**
 * Per-episode word frequency (by lemma).
 *
 * Counts how often each lemma appears across the whole episode's subtitles. The
 * episode's cues are cached (see subtitles-cache); we lemmatize them once —
 * chunked through /api/v1/parse — build a lemma→count map, and cache it in
 * IndexedDB. Computed lazily but also warmed when the cues load, so the count is
 * usually ready by the time a word is hovered.
 */
import type { ParseResponse } from '../shared/api-types';
import type { SubtitleCue } from '../shared/subtitles';
import { api } from './api-client';
import { idbKvStore, type KvStore } from './idb';
import { cuesCache } from './subtitles-cache';

const CHUNK_CHARS = 1800; // under the /api/v1/parse 2000-char cap
const norm = (s: string): string => s.toLocaleLowerCase();

type ParseClient = { postJson<T>(path: string, body: unknown): Promise<T> };

function chunkCues(cues: SubtitleCue[]): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const cue of cues) {
    const line = `${cue.text}\n`;
    if (cur.length + line.length > CHUNK_CHARS && cur.length > 0) {
      chunks.push(cur);
      cur = '';
    }
    cur += line;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

export class FrequencyIndex {
  private inflight = new Map<string, Promise<Map<string, number>>>();

  constructor(
    private store: KvStore = idbKvStore(),
    private client: ParseClient = api,
  ) {}

  private key(episode: string): string {
    return `freq:${episode}`;
  }

  async ensure(language: string, episode: string): Promise<Map<string, number>> {
    const cached = await this.store.get<Record<string, number>>(this.key(episode));
    if (cached) return new Map(Object.entries(cached));

    const existing = this.inflight.get(episode);
    if (existing) return existing;

    const job = this.compute(language, episode);
    this.inflight.set(episode, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(episode);
    }
  }

  private async compute(language: string, episode: string): Promise<Map<string, number>> {
    const cues = await cuesCache.get(episode);
    const counts = new Map<string, number>();
    if (!cues || cues.length === 0) return counts;

    for (const chunk of chunkCues(cues)) {
      try {
        const parse = await this.client.postJson<ParseResponse>('/api/v1/parse', {
          language,
          text: chunk,
        });
        for (const token of parse.tokens) {
          if (!token.is_word) continue;
          const lemma = token.candidates[0]?.lemma;
          if (lemma) {
            const k = norm(lemma);
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
      } catch {
        // Skip a failed chunk (NLP hiccup); don't cache a partial/empty result.
      }
    }

    if (counts.size > 0) {
      await this.store.set(this.key(episode), Object.fromEntries(counts));
    }
    return counts;
  }

  async count(language: string, episode: string, lemma: string): Promise<number> {
    const map = await this.ensure(language, episode);
    return map.get(norm(lemma)) ?? 0;
  }
}

export const frequencyIndex = new FrequencyIndex();
