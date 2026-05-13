// @vitest-environment node
/**
 * Tests for /moderation/paradigms/[id] SSR loader + actions.
 *
 * The page is admin-only. The interesting wire-level decisions:
 *   - the editor's "Save changes" button posts a JSON `payload` to
 *     `?/saveAll` and that one action handles paradigm metadata +
 *     per-slot edits + reorder atomically.
 *   - add / remove / delete-paradigm fire immediately under their
 *     own actions, each gated by an inline confirmation in the UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadParadigm = vi.fn();
const saveAllParadigmChanges = vi.fn();
const deleteParadigm = vi.fn();
const createSlot = vi.fn();
const deleteSlot = vi.fn();
const countLemmasUsingParadigm = vi.fn();
const regenerateAllForParadigm = vi.fn();

vi.mock('$lib/server/dictionary/paradigms.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/paradigms.js')>(
    '$lib/server/dictionary/paradigms.js',
  );
  return {
    ...actual,
    loadParadigm: (...a: unknown[]) => loadParadigm(...a),
    saveAllParadigmChanges: (...a: unknown[]) => saveAllParadigmChanges(...a),
    deleteParadigm: (...a: unknown[]) => deleteParadigm(...a),
    createSlot: (...a: unknown[]) => createSlot(...a),
    deleteSlot: (...a: unknown[]) => deleteSlot(...a),
    countLemmasUsingParadigm: (...a: unknown[]) => countLemmasUsingParadigm(...a),
  };
});

vi.mock('$lib/server/dictionary/lemma-forms.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/lemma-forms.js')>(
    '$lib/server/dictionary/lemma-forms.js',
  );
  return {
    ...actual,
    regenerateAllForParadigm: (...a: unknown[]) => regenerateAllForParadigm(...a),
  };
});

type Mod = typeof import('./+page.server.js');
const PARADIGM_ID = '00000000-0000-0000-0000-0000000000a1';
const SLOT_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SLOT_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN = { id: 'admin-1', role: 'admin' as const };
const CURATOR = { id: 'cur-1', role: 'curator' as const };

async function callLoad(
  user: { id: string; role: 'admin' | 'curator' | 'user' } | null,
  paradigmId = PARADIGM_ID,
) {
  const { load } = (await import('./+page.server.js')) as Mod;
  const event = {
    locals: { user },
    params: { id: paradigmId },
    url: new URL(`http://x/moderation/paradigms/${paradigmId}`),
  } as unknown as Parameters<Mod['load']>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status?: number; location?: string };
  }
}

async function callAction(
  name:
    | 'saveAll'
    | 'deleteParadigm'
    | 'addSlot'
    | 'removeSlot'
    | 'regenerateAffected',
  fields: Record<string, string>,
  user: { id: string; role: 'admin' | 'curator' | 'user' } | null = ADMIN,
  paradigmId = PARADIGM_ID,
) {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const event = {
    locals: { user },
    params: { id: paradigmId },
    request: {
      formData: () => Promise.resolve(fd),
    } as unknown as Request,
  } as unknown as Parameters<Mod['actions'][string]>[0];
  return actions[name]!(event);
}

beforeEach(() => {
  loadParadigm.mockReset();
  saveAllParadigmChanges.mockReset();
  deleteParadigm.mockReset();
  createSlot.mockReset();
  deleteSlot.mockReset();
  countLemmasUsingParadigm.mockReset();
  countLemmasUsingParadigm.mockResolvedValue(0);
  regenerateAllForParadigm.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('/moderation/paradigms/[id] loader', () => {
  it('hydrates the paradigm + slots for an admin', async () => {
    loadParadigm.mockResolvedValueOnce({
      paradigm: { id: PARADIGM_ID, language: 'or', pos: 'VERB', name: 'Odia regular verb' },
      slots: [
        { id: SLOT_ID_1, slotKey: 'inf', features: { VerbForm: 'Inf' }, suffix: 'ିବା', sortOrder: 10 },
      ],
    });
    const data = (await callLoad(ADMIN)) as {
      paradigm: { name: string };
      slots: { id: string }[];
    };
    expect(data.paradigm.name).toBe('Odia regular verb');
    expect(data.slots).toHaveLength(1);
    expect(data.slots[0]!.id).toBe(SLOT_ID_1);
  });

  it('404s when the paradigm is unknown', async () => {
    loadParadigm.mockResolvedValueOnce(null);
    const res = (await callLoad(ADMIN)) as { status: number };
    expect(res.status).toBe(404);
  });

  it('rejects a malformed paradigm id with 400', async () => {
    const res = (await callLoad(ADMIN, 'not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(loadParadigm).not.toHaveBeenCalled();
  });

  it('forbids curators', async () => {
    const res = (await callLoad(CURATOR)) as { status: number };
    expect(res.status).toBe(403);
    expect(loadParadigm).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated visitor', async () => {
    const res = (await callLoad(null)) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
  });
});

describe('?/saveAll action', () => {
  function payload(over: Partial<{
    paradigm: Record<string, unknown>;
    slots: Array<Record<string, unknown>>;
  }> = {}): string {
    const paradigm = {
      language: 'or',
      pos: 'VERB',
      name: 'Odia regular verb',
      description: 'updated',
      ...(over.paradigm ?? {}),
    };
    const slots = over.slots ?? [
      {
        id: SLOT_ID_1,
        slotKey: 'inf',
        features: { VerbForm: 'Inf' },
        suffix: 'ିବା',
      },
    ];
    return JSON.stringify({ paradigm, slots });
  }

  it('forwards the parsed JSON payload to the service', async () => {
    saveAllParadigmChanges.mockResolvedValueOnce(undefined);
    const result = (await callAction('saveAll', { payload: payload() })) as {
      ok: boolean;
      section: string;
      affectedLemmaCount: number;
    };
    expect(result.ok).toBe(true);
    expect(result.section).toBe('saveAll');
    expect(saveAllParadigmChanges).toHaveBeenCalledWith(PARADIGM_ID, {
      paradigm: {
        language: 'or',
        pos: 'VERB',
        name: 'Odia regular verb',
        description: 'updated',
      },
      slots: [
        {
          id: SLOT_ID_1,
          slotKey: 'inf',
          features: { VerbForm: 'Inf' },
          suffix: 'ିବା',
        },
      ],
    });
    // Default mock returns 0 — verify the count is surfaced for the
    // UI's regen prompt to decide whether to render itself.
    expect(result.affectedLemmaCount).toBe(0);
  });

  it('returns the count of lemmas using this paradigm', async () => {
    saveAllParadigmChanges.mockResolvedValueOnce(undefined);
    countLemmasUsingParadigm.mockResolvedValueOnce(7);
    const result = (await callAction('saveAll', { payload: payload() })) as {
      ok: boolean;
      affectedLemmaCount: number;
    };
    expect(result.ok).toBe(true);
    expect(result.affectedLemmaCount).toBe(7);
    expect(countLemmasUsingParadigm).toHaveBeenCalledWith(PARADIGM_ID);
  });

  it('accepts a null description and forwards it through', async () => {
    saveAllParadigmChanges.mockResolvedValueOnce(undefined);
    await callAction('saveAll', {
      payload: payload({ paradigm: { description: null } }),
    });
    const args = saveAllParadigmChanges.mock.calls[0]![1] as {
      paradigm: { description: unknown };
    };
    expect(args.paradigm.description).toBeNull();
  });

  it('returns 400 when the payload is missing', async () => {
    const result = (await callAction('saveAll', {})) as {
      status: number;
      data: { section: string; message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('saveAll');
    expect(saveAllParadigmChanges).not.toHaveBeenCalled();
  });

  it('returns 400 when the payload is not valid JSON', async () => {
    const result = (await callAction('saveAll', { payload: 'not-json' })) as {
      status: number;
      data: { message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.message).toContain('Malformed');
  });

  it('rejects an unsupported language', async () => {
    const result = (await callAction('saveAll', {
      payload: payload({ paradigm: { language: 'xx' } }),
    })) as { status: number; data: { ok: boolean } };
    expect(result.status).toBe(400);
    expect(result.data.ok).toBe(false);
    expect(saveAllParadigmChanges).not.toHaveBeenCalled();
  });

  it('rejects a slot id that is not a UUID', async () => {
    const result = (await callAction('saveAll', {
      payload: payload({
        slots: [
          {
            id: 'not-a-uuid',
            slotKey: 'inf',
            features: {},
            suffix: '',
          },
        ],
      }),
    })) as { status: number };
    expect(result.status).toBe(400);
    expect(saveAllParadigmChanges).not.toHaveBeenCalled();
  });

  it('forbids non-admin', async () => {
    const result = (await callAction(
      'saveAll',
      { payload: payload() },
      CURATOR,
    )) as { status: number };
    expect(result.status).toBe(403);
    expect(saveAllParadigmChanges).not.toHaveBeenCalled();
  });
});

describe('?/addSlot action', () => {
  beforeEach(() => {
    loadParadigm.mockResolvedValue({
      paradigm: { id: PARADIGM_ID, language: 'or', pos: 'VERB', name: 'P' },
      slots: [
        { id: SLOT_ID_1, slotKey: 'inf', features: {}, suffix: '', sortOrder: 10 },
        { id: SLOT_ID_2, slotKey: 'past_3sg', features: {}, suffix: '', sortOrder: 40 },
      ],
    });
  });

  it('parses Key=Value features and appends past the max sort_order', async () => {
    createSlot.mockResolvedValueOnce({ id: 'new-slot' });
    const result = (await callAction('addSlot', {
      slotKey: 'pres_hab_1sg',
      suffix: 'े',
      features: 'Tense=Pres, Aspect=Hab, Person=1, Number=Sing',
    })) as { ok: boolean; action: string };
    expect(result.ok).toBe(true);
    expect(result.action).toBe('add');
    expect(createSlot).toHaveBeenCalledWith({
      paradigmId: PARADIGM_ID,
      slotKey: 'pres_hab_1sg',
      features: { Tense: 'Pres', Aspect: 'Hab', Person: '1', Number: 'Sing' },
      suffix: 'े',
      sortOrder: 50,
    });
  });

  it('respects an explicit sort_order when provided', async () => {
    createSlot.mockResolvedValueOnce({ id: 'new-slot' });
    await callAction('addSlot', {
      slotKey: 'mid',
      suffix: '',
      features: '',
      sortOrder: '25',
    });
    expect(createSlot).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 25 }),
    );
  });

  it('rejects a missing slot_key via 400', async () => {
    const result = (await callAction('addSlot', {
      slotKey: '',
      suffix: '',
    })) as { status: number; data: { ok: boolean; section: string; action: string } };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('slot');
    expect(result.data.action).toBe('add');
    expect(createSlot).not.toHaveBeenCalled();
  });
});

describe('?/removeSlot action', () => {
  it('forwards the slot id', async () => {
    deleteSlot.mockResolvedValueOnce(undefined);
    const result = (await callAction('removeSlot', { slotId: SLOT_ID_1 })) as {
      ok: boolean;
      action: string;
    };
    expect(result.ok).toBe(true);
    expect(result.action).toBe('remove');
    expect(deleteSlot).toHaveBeenCalledWith(SLOT_ID_1);
  });

  it('rejects a non-uuid slot id with 400', async () => {
    const result = (await callAction('removeSlot', { slotId: 'not-a-uuid' })) as {
      status: number;
    };
    expect(result.status).toBe(400);
    expect(deleteSlot).not.toHaveBeenCalled();
  });
});

describe('?/regenerateAffected action', () => {
  it('forwards to regenerateAllForParadigm and surfaces the summary', async () => {
    regenerateAllForParadigm.mockResolvedValueOnce({
      lemmasProcessed: 3,
      lemmasFailed: 0,
      removed: 27,
      inserted: 30,
      failures: [],
    });
    const result = (await callAction('regenerateAffected', {})) as {
      ok: boolean;
      section: string;
      lemmasProcessed: number;
      removed: number;
      inserted: number;
    };
    expect(result.ok).toBe(true);
    expect(result.section).toBe('regenerate');
    expect(result.lemmasProcessed).toBe(3);
    expect(result.removed).toBe(27);
    expect(result.inserted).toBe(30);
    expect(regenerateAllForParadigm).toHaveBeenCalledWith(PARADIGM_ID);
  });

  it('reports per-lemma failures without failing the action', async () => {
    regenerateAllForParadigm.mockResolvedValueOnce({
      lemmasProcessed: 2,
      lemmasFailed: 1,
      removed: 18,
      inserted: 20,
      failures: [{ lemmaId: 'l-99', headword: 'बोलना', error: 'nlp down' }],
    });
    const result = (await callAction('regenerateAffected', {})) as {
      ok: boolean;
      lemmasFailed: number;
      failures: Array<{ headword: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.lemmasFailed).toBe(1);
    expect(result.failures[0]!.headword).toBe('बोलना');
  });

  it('forbids a curator', async () => {
    const result = (await callAction(
      'regenerateAffected',
      {},
      CURATOR,
    )) as { status: number };
    expect(result.status).toBe(403);
    expect(regenerateAllForParadigm).not.toHaveBeenCalled();
  });
});

describe('?/deleteParadigm action', () => {
  it('redirects to the list after a successful delete', async () => {
    deleteParadigm.mockResolvedValueOnce(undefined);
    let thrown: unknown;
    try {
      await callAction('deleteParadigm', {});
    } catch (e) {
      thrown = e;
    }
    expect(deleteParadigm).toHaveBeenCalledWith(PARADIGM_ID);
    const r = thrown as { status?: number; location?: string };
    expect(r?.status).toBe(303);
    expect(r?.location).toBe('/moderation/paradigms');
  });

  it('forbids a curator', async () => {
    const result = (await callAction('deleteParadigm', {}, CURATOR)) as {
      status: number;
    };
    expect(result.status).toBe(403);
    expect(deleteParadigm).not.toHaveBeenCalled();
  });
});
