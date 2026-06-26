/**
 * Personal (user-authored) dictionary translations.
 *
 * These are NOT local-only: they're written to the user's account on the
 * backend (`source: 'user'` rows), so they show up in the reader app and on the
 * website too. The reader popup / dictionary surfaces them in a "personal"
 * bucket above official + community entries. Requires a logged-in, verified
 * account on whichever backend the extension points at (local dev or parhiba.com).
 */
import type { PersonalTranslation } from '../shared/lookup';
import { api } from './api-client';

export type { PersonalTranslation };

type PersonalClient = {
  getJson<T>(path: string): Promise<T>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  patchJson<T>(path: string, body: unknown): Promise<T>;
  del(path: string): Promise<void>;
};

type Pub = { id: string; body: string; targetLanguage: string };

export class UserTranslations {
  constructor(private client: PersonalClient = api) {}

  /** The acting user's own translations for a lemma (the "personal" bucket). */
  async list(lemmaId: string): Promise<PersonalTranslation[]> {
    const r = await this.client.getJson<{ translations: { personal: Pub[] } }>(
      `/api/v1/lemmas/${lemmaId}/translations`,
    );
    return r.translations.personal.map((t) => ({
      id: t.id,
      body: t.body,
      targetLanguage: t.targetLanguage,
    }));
  }

  async add(lemmaId: string, body: string, targetLanguage: string): Promise<PersonalTranslation> {
    const r = await this.client.postJson<{ translation: Pub }>('/api/v1/translations', {
      lemmaId,
      body,
      targetLanguage,
    });
    return {
      id: r.translation.id,
      body: r.translation.body,
      targetLanguage: r.translation.targetLanguage,
    };
  }

  async edit(id: string, body: string): Promise<void> {
    await this.client.patchJson(`/api/v1/translations/${id}`, { body });
  }

  async remove(id: string): Promise<void> {
    await this.client.del(`/api/v1/translations/${id}`);
  }
}

export const userTranslations = new UserTranslations();
