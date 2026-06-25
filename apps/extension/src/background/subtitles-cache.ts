/**
 * Per-episode subtitle-cue cache (IndexedDB). Once an episode's .vtt has been
 * seen, its parsed cues are stored under the episode key so revisiting the
 * episode loads the clickable overlay without re-enabling subtitles.
 */
import type { SubtitleCue } from '../shared/subtitles';
import { idbKvStore, type KvStore } from './idb';

const key = (episode: string) => `cues:${episode}`;

export class CuesCache {
  constructor(private store: KvStore = idbKvStore()) {}

  async set(episode: string, cues: SubtitleCue[]): Promise<void> {
    await this.store.set(key(episode), cues);
  }

  async get(episode: string): Promise<SubtitleCue[] | null> {
    return (await this.store.get<SubtitleCue[]>(key(episode))) ?? null;
  }
}

export const cuesCache = new CuesCache();
