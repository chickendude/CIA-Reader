// @vitest-environment node
/**
 * Tests for /moderation/dictionary/:id SSR loader and form actions (T-3.7).
 *
 * The loader + every action delegates to the curator service; these tests
 * mock that layer and assert the web-form plumbing (shape of the loader
 * output, form validation, discriminated action results) — not the
 * service semantics, which are covered in curator.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getLemmaEditorView = vi.fn();
const updateLemma = vi.fn();
const setLemmaLock = vi.fn();
const updateTranslation = vi.fn();
const setTranslationHidden = vi.fn();
const mergeLemmas = vi.fn();
const splitLemma = vi.fn();
const reorderTranslations = vi.fn();
const listFormsForLemma = vi.fn();
const createForm = vi.fn();
const updateForm = vi.fn();
const deleteForm = vi.fn();
const setLemmaParadigm = vi.fn();
const regenerateForms = vi.fn();
const listParadigmsForLemma = vi.fn();

vi.mock('$lib/server/dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/dictionary/curator.js')
  >('$lib/server/dictionary/curator.js');
  return {
    ...actual,
    getLemmaEditorView: (...a: unknown[]) => getLemmaEditorView(...a),
    updateLemma: (...a: unknown[]) => updateLemma(...a),
    setLemmaLock: (...a: unknown[]) => setLemmaLock(...a),
    updateTranslation: (...a: unknown[]) => updateTranslation(...a),
    setTranslationHidden: (...a: unknown[]) => setTranslationHidden(...a),
    mergeLemmas: (...a: unknown[]) => mergeLemmas(...a),
    splitLemma: (...a: unknown[]) => splitLemma(...a),
    reorderTranslations: (...a: unknown[]) => reorderTranslations(...a),
  };
});

vi.mock('$lib/server/dictionary/lemma-forms.js', () => ({
  listFormsForLemma: (...a: unknown[]) => listFormsForLemma(...a),
  createForm: (...a: unknown[]) => createForm(...a),
  updateForm: (...a: unknown[]) => updateForm(...a),
  deleteForm: (...a: unknown[]) => deleteForm(...a),
  setLemmaParadigm: (...a: unknown[]) => setLemmaParadigm(...a),
  regenerateForms: (...a: unknown[]) => regenerateForms(...a),
}));

vi.mock('$lib/server/dictionary/paradigms.js', () => ({
  listParadigmsForLemma: (...a: unknown[]) => listParadigmsForLemma(...a),
}));

type Mod = typeof import('./+page.server.js');

const LEMMA_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = { id: 'u1', role: 'curator' as const };

async function callLoad(id = LEMMA_ID, user: typeof USER | null = USER) {
  const { load } = (await import('./+page.server.js')) as Mod;
  const event = {
    params: { id },
    locals: { user },
  } as Parameters<Mod['load']>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status: number };
  }
}

async function callAction(
  name: keyof Mod['actions'],
  fields: Record<string, string>,
  id = LEMMA_ID,
) {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const event = {
    params: { id },
    locals: { user: USER },
    request: new Request('http://x', { method: 'POST', body: fd }),
  } as unknown as Parameters<Mod['actions'][typeof name]>[0];
  return actions[name]!(event);
}

beforeEach(() => {
  getLemmaEditorView.mockReset();
  updateLemma.mockReset();
  setLemmaLock.mockReset();
  updateTranslation.mockReset();
  setTranslationHidden.mockReset();
  mergeLemmas.mockReset();
  splitLemma.mockReset();
  reorderTranslations.mockReset();
  // Form-section mocks default to empty results so existing tests
  // that don't care about the form section keep working.
  listFormsForLemma.mockReset();
  listFormsForLemma.mockResolvedValue([]);
  listParadigmsForLemma.mockReset();
  listParadigmsForLemma.mockResolvedValue([]);
  createForm.mockReset();
  updateForm.mockReset();
  deleteForm.mockReset();
  setLemmaParadigm.mockReset();
  regenerateForms.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('moderation lemma editor loader', () => {
  it('returns the editor view on success', async () => {
    const view = {
      lemma: { id: LEMMA_ID, headword: 'बोलना', language: 'hi', pos: 'VERB' },
      translations: [],
      forms: [],
      history: [],
    };
    getLemmaEditorView.mockResolvedValueOnce(view);
    const data = (await callLoad()) as { lemma: { id: string } };
    expect(data.lemma.id).toBe(LEMMA_ID);
    expect(getLemmaEditorView).toHaveBeenCalledWith(USER, LEMMA_ID);
  });

  it('rejects a malformed lemma id with 400', async () => {
    const res = (await callLoad('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(getLemmaEditorView).not.toHaveBeenCalled();
  });

  it('maps CuratorValidationError(404) to a 404', async () => {
    const { CuratorValidationError } = await import(
      '$lib/server/dictionary/curator.js'
    );
    getLemmaEditorView.mockRejectedValueOnce(
      new CuratorValidationError('gone', 404),
    );
    const res = (await callLoad()) as { status: number };
    expect(res.status).toBe(404);
  });
});

describe('moderation lemma editor actions', () => {
  it('updateLemma happy path returns section=lemma, ok=true', async () => {
    updateLemma.mockResolvedValueOnce({ id: LEMMA_ID });
    const res = await callAction('updateLemma', {
      headword: 'बोलना',
      pos: 'verb',
      glossDefault: 'to speak',
      frequencyRank: '123',
      sourceAttribution: '',
      reason: 'fix typo',
    });
    expect(res).toEqual({ ok: true, section: 'lemma' });
    expect(updateLemma).toHaveBeenCalledWith(
      USER,
      LEMMA_ID,
      expect.objectContaining({ headword: 'बोलना', frequencyRank: 123 }),
      'fix typo',
    );
  });

  it('updateLemma accepts an empty reason now (forwarded as-is to the service)', async () => {
    updateLemma.mockResolvedValueOnce({ id: LEMMA_ID });
    const res = await callAction('updateLemma', {
      headword: 'बोलना',
      pos: 'VERB',
      glossDefault: '',
      frequencyRank: '',
      sourceAttribution: '',
      // No reason field at all — schema defaults to ''.
    });
    expect(res).toEqual({ ok: true, section: 'lemma' });
    expect(updateLemma).toHaveBeenCalledWith(
      USER,
      LEMMA_ID,
      expect.any(Object),
      '',
    );
  });

  it('merge forwards winnerId from params and loserId from form', async () => {
    mergeLemmas.mockResolvedValueOnce({ translationsMoved: 0, formsMoved: 0 });
    const res = await callAction('merge', {
      loserId: OTHER_ID,
      reason: 'duplicate',
    });
    expect(res).toEqual({ ok: true, section: 'merge' });
    expect(mergeLemmas).toHaveBeenCalledWith(
      USER,
      { winnerId: LEMMA_ID, loserId: OTHER_ID },
      'duplicate',
    );
  });

  it('merge returns 400 when loserId is not a UUID', async () => {
    const res = await callAction('merge', {
      loserId: 'nope',
      reason: 'duplicate',
    });
    expect((res as { status: number }).status).toBe(400);
    expect(mergeLemmas).not.toHaveBeenCalled();
  });

  it('split parses translationIds as comma-separated UUIDs', async () => {
    splitLemma.mockResolvedValueOnce({
      created: { id: 'new-id' },
    });
    const tid1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const tid2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const res = await callAction('split', {
      newHeadword: 'सोना',
      newPos: 'noun',
      newGloss: 'gold',
      translationIds: `${tid1}, ${tid2}`,
      reason: 'disambiguate',
    });
    expect((res as { ok: boolean }).ok).toBe(true);
    expect(splitLemma).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        translationIds: [tid1, tid2],
        newLemma: expect.objectContaining({ headword: 'सोना', pos: 'noun' }),
      }),
      'disambiguate',
    );
  });

  it('setTranslationHidden forwards the translation id and boolean', async () => {
    setTranslationHidden.mockResolvedValueOnce({});
    const tid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const res = await callAction('setTranslationHidden', {
      translationId: tid,
      hidden: 'true',
      reason: 'spam submission',
    });
    expect((res as { ok: boolean; section: string; translationId: string })).toEqual({
      ok: true,
      section: 'translation',
      translationId: tid,
    });
    expect(setTranslationHidden).toHaveBeenCalledWith(
      USER,
      tid,
      true,
      'spam submission',
    );
  });

  it('reorderTranslations parses the comma-separated id list and forwards in order (T-3.13)', async () => {
    reorderTranslations.mockResolvedValueOnce([]);
    const a = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const b = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const res = await callAction('reorderTranslations', {
      orderedTranslationIds: `${a}, ${b}`,
      reason: 'pin curated above import',
    });
    expect(res).toEqual({ ok: true, section: 'reorder' });
    expect(reorderTranslations).toHaveBeenCalledWith(
      USER,
      LEMMA_ID,
      [a, b],
      'pin curated above import',
    );
  });

  it('reorderTranslations rejects when no valid UUIDs survive parsing (T-3.13)', async () => {
    const res = await callAction('reorderTranslations', {
      orderedTranslationIds: 'not-a-uuid, also-bad',
      reason: 'malformed payload',
    });
    expect((res as { status?: number }).status ?? 200).toBe(400);
    expect(reorderTranslations).not.toHaveBeenCalled();
  });
});
