import { describe, expect, it, vi } from 'vitest';

import { UserTranslations } from './user-translations';

function client(over: Partial<Record<'getJson' | 'postJson' | 'patchJson' | 'del', unknown>> = {}) {
  return {
    getJson: vi.fn(),
    postJson: vi.fn(),
    patchJson: vi.fn(),
    del: vi.fn(),
    ...over,
  } as never;
}

describe('UserTranslations', () => {
  it('lists only the personal bucket, mapped to {id, body, targetLanguage}', async () => {
    const getJson = vi.fn().mockResolvedValue({
      translations: {
        personal: [{ id: 'p1', body: 'mine', targetLanguage: 'en', extra: 'ignored' }],
        official: [{ id: 'o1', body: 'theirs', targetLanguage: 'en' }],
        community: [],
      },
    });
    const ut = new UserTranslations(client({ getJson }));
    const items = await ut.list('lemma-1');
    expect(getJson).toHaveBeenCalledWith('/api/v1/lemmas/lemma-1/translations');
    expect(items).toEqual([{ id: 'p1', body: 'mine', targetLanguage: 'en' }]);
  });

  it('adds a translation against a lemma', async () => {
    const postJson = vi.fn().mockResolvedValue({
      translation: { id: 'new', body: 'to stop', targetLanguage: 'en' },
    });
    const ut = new UserTranslations(client({ postJson }));
    const t = await ut.add('lemma-1', 'to stop', 'en');
    expect(postJson).toHaveBeenCalledWith('/api/v1/translations', {
      lemmaId: 'lemma-1',
      body: 'to stop',
      targetLanguage: 'en',
    });
    expect(t).toEqual({ id: 'new', body: 'to stop', targetLanguage: 'en' });
  });

  it('edits and deletes by translation id', async () => {
    const patchJson = vi.fn().mockResolvedValue({});
    const del = vi.fn().mockResolvedValue(undefined);
    const ut = new UserTranslations(client({ patchJson, del }));

    await ut.edit('t1', 'fixed');
    expect(patchJson).toHaveBeenCalledWith('/api/v1/translations/t1', { body: 'fixed' });

    await ut.remove('t1');
    expect(del).toHaveBeenCalledWith('/api/v1/translations/t1');
  });
});
