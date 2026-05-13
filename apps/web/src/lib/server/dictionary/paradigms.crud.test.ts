// @vitest-environment node
/**
 * Unit tests for the paradigm-editor service (curator-paradigm
 * follow-up). The admin page at /moderation/paradigms calls these
 * helpers; the page tests mock them, so the only place the actual
 * query logic + validation rules are exercised is here.
 *
 * Pattern (matches curator.test.ts): we stage SELECT result rows in
 * order, log every write payload, and pass a swapped-in `db` mock
 * with chainable methods. `db.transaction` invokes the callback with
 * the same mock so saveAllParadigmChanges can be exercised end-to-end
 * without a real Postgres.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'update'; set?: unknown }
  | { kind: 'insert'; values?: unknown }
  | { kind: 'delete' };
const calls: Call[] = [];

const staged: Array<unknown[]> = [];
function stage(rows: unknown[]) {
  staged.push(rows);
}
function nextStaged(): unknown[] {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result available');
  return v;
}

let insertFailure: Error | null = null;

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

function makeUpdateChain() {
  const entry: Call = { kind: 'update' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn((v: unknown) => {
    entry.set = v;
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(() => nextStaged());
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

function makeInsertChain() {
  const entry: Call = { kind: 'insert' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn((v: unknown) => {
    entry.values = v;
    return chain;
  });
  chain.returning = vi.fn(() => {
    if (insertFailure) {
      const err = insertFailure;
      insertFailure = null;
      throw err;
    }
    return nextStaged();
  });
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

function makeDeleteChain() {
  calls.push({ kind: 'delete' });
  const chain: Record<string, unknown> = {};
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(() => nextStaged());
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const dbMock = {
  select: () => {
    calls.push({ kind: 'select' });
    return makeSelectChain();
  },
  update: () => makeUpdateChain(),
  insert: () => makeInsertChain(),
  delete: () => makeDeleteChain(),
  transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(dbMock),
};

vi.mock('../db/index.js', () => ({
  db: dbMock,
  schema: {
    paradigms: {
      id: 'paradigms.id',
      language: 'paradigms.language',
      pos: 'paradigms.pos',
      name: 'paradigms.name',
      description: 'paradigms.description',
      updatedAt: 'paradigms.updated_at',
    },
    paradigmSlots: {
      id: 'paradigm_slots.id',
      paradigmId: 'paradigm_slots.paradigm_id',
      slotKey: 'paradigm_slots.slot_key',
      features: 'paradigm_slots.features',
      suffix: 'paradigm_slots.suffix',
      sortOrder: 'paradigm_slots.sort_order',
    },
    lemmas: {
      id: 'lemmas.id',
      headword: 'lemmas.headword',
      pos: 'lemmas.pos',
      language: 'lemmas.language',
      paradigmId: 'lemmas.paradigm_id',
      stem: 'lemmas.stem',
    },
  },
}));

const {
  ParadigmValidationError,
  countLemmasUsingParadigm,
  createParadigm,
  createSlot,
  deleteParadigm,
  deleteSlot,
  listLemmasUsingParadigm,
  listParadigms,
  saveAllParadigmChanges,
  updateParadigm,
  updateSlot,
} = await import('./paradigms.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  insertFailure = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function paradigmRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    language: 'or',
    pos: 'VERB',
    name: 'Odia regular verb',
    description: 'desc',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function slotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    paradigmId: 'p-1',
    slotKey: 'inf',
    features: { VerbForm: 'Inf' },
    suffix: 'ିବା',
    sortOrder: 10,
    ...overrides,
  };
}

describe('loadParadigm', () => {
  it('returns the paradigm and its slots ordered by sortOrder', async () => {
    stage([paradigmRow()]); // paradigm row
    stage([slotRow(), slotRow({ id: 's-2', slotKey: 'past', sortOrder: 20 })]);
    const loaded = await (
      await import('./paradigms.js')
    ).loadParadigm('p-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.paradigm.id).toBe('p-1');
    expect(loaded!.slots).toHaveLength(2);
  });

  it('returns null when the paradigm is unknown', async () => {
    stage([]); // empty
    const loaded = await (await import('./paradigms.js')).loadParadigm('p-x');
    expect(loaded).toBeNull();
  });
});

describe('listParadigmsForLemma', () => {
  it('queries by language + pos', async () => {
    stage([
      paradigmRow({ language: 'hi', pos: 'NOUN' }),
      paradigmRow({ id: 'p-2', language: 'hi', pos: 'NOUN', name: 'Another' }),
    ]);
    const rows = await (
      await import('./paradigms.js')
    ).listParadigmsForLemma('hi', 'NOUN');
    expect(rows).toHaveLength(2);
  });
});

describe('listParadigms', () => {
  it('returns every paradigm when no filter is supplied', async () => {
    stage([paradigmRow(), paradigmRow({ id: 'p-2', name: 'Other' })]);
    const rows = await listParadigms();
    expect(rows).toHaveLength(2);
  });

  it('filters by language', async () => {
    stage([paradigmRow({ language: 'hi' })]);
    const rows = await listParadigms({ language: 'hi' });
    expect(rows[0]!.language).toBe('hi');
  });

  it('filters by pos (trimming whitespace)', async () => {
    stage([paradigmRow()]);
    const rows = await listParadigms({ pos: '  VERB  ' });
    expect(rows).toHaveLength(1);
  });

  it('ignores an empty `pos` filter', async () => {
    stage([paradigmRow()]);
    await listParadigms({ pos: '' });
    // Just verifying we don't crash on the trim-and-skip path.
    expect(calls.filter((c) => c.kind === 'select')).toHaveLength(1);
  });
});

describe('createParadigm', () => {
  it('inserts a validated paradigm and returns the row', async () => {
    stage([paradigmRow({ id: 'p-new' })]);
    const row = await createParadigm({
      language: 'or',
      pos: 'VERB',
      name: '  Odia regular verb  ',
      description: '  trim me  ',
    });
    expect(row.id).toBe('p-new');
    const insert = calls.find((c) => c.kind === 'insert')!;
    expect(insert.values).toMatchObject({
      language: 'or',
      pos: 'VERB',
      name: 'Odia regular verb',
      description: 'trim me',
    });
  });

  it('coerces an empty / whitespace description to null', async () => {
    stage([paradigmRow()]);
    await createParadigm({
      language: 'or',
      pos: 'VERB',
      name: 'x',
      description: '   ',
    });
    const insert = calls.find((c) => c.kind === 'insert')!;
    expect((insert.values as { description: unknown }).description).toBeNull();
  });

  it('rejects an unsupported language', async () => {
    await expect(
      createParadigm({ language: 'xx', pos: 'VERB', name: 'x' }),
    ).rejects.toBeInstanceOf(ParadigmValidationError);
  });

  it('rejects an empty pos', async () => {
    await expect(
      createParadigm({ language: 'or', pos: '   ', name: 'x' }),
    ).rejects.toThrowError(/pos is required/);
  });

  it('rejects an over-long pos', async () => {
    await expect(
      createParadigm({ language: 'or', pos: 'X'.repeat(33), name: 'x' }),
    ).rejects.toThrowError(/pos is too long/);
  });

  it('rejects an empty name', async () => {
    await expect(
      createParadigm({ language: 'or', pos: 'VERB', name: '   ' }),
    ).rejects.toThrowError(/name is required/);
  });

  it('rejects an over-long name', async () => {
    await expect(
      createParadigm({ language: 'or', pos: 'VERB', name: 'x'.repeat(129) }),
    ).rejects.toThrowError(/name is too long/);
  });

  it('throws 500 when the insert returns no row', async () => {
    stage([]);
    await expect(
      createParadigm({ language: 'or', pos: 'VERB', name: 'x' }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe('updateParadigm', () => {
  it('loads the current row, merges the patch, and writes the update', async () => {
    stage([paradigmRow()]); // load
    stage([paradigmRow({ name: 'new name' })]); // return from update
    const row = await updateParadigm('p-1', { name: 'new name' });
    expect(row.name).toBe('new name');
    const update = calls.find((c) => c.kind === 'update')!;
    expect((update.set as { name: string }).name).toBe('new name');
  });

  it('preserves the original description when the patch omits it', async () => {
    stage([paradigmRow({ description: 'keep me' })]);
    stage([paradigmRow({ description: 'keep me' })]);
    await updateParadigm('p-1', { name: 'x' });
    const update = calls.find((c) => c.kind === 'update')!;
    expect((update.set as { description: unknown }).description).toBe('keep me');
  });

  it('clears the description when given empty string', async () => {
    stage([paradigmRow({ description: 'old' })]);
    stage([paradigmRow({ description: null })]);
    await updateParadigm('p-1', { description: '   ' });
    const update = calls.find((c) => c.kind === 'update')!;
    expect((update.set as { description: unknown }).description).toBeNull();
  });

  it('clears the description when given null', async () => {
    stage([paradigmRow({ description: 'old' })]);
    stage([paradigmRow({ description: null })]);
    await updateParadigm('p-1', { description: null });
    const update = calls.find((c) => c.kind === 'update')!;
    expect((update.set as { description: unknown }).description).toBeNull();
  });

  it('writes a trimmed non-empty description', async () => {
    stage([paradigmRow({ description: 'old' })]);
    stage([paradigmRow({ description: 'fresh' })]);
    await updateParadigm('p-1', { description: '  fresh  ' });
    const update = calls.find((c) => c.kind === 'update')!;
    expect((update.set as { description: string }).description).toBe('fresh');
  });

  it('throws 404 when the paradigm does not exist', async () => {
    stage([]); // load returns nothing
    await expect(
      updateParadigm('p-missing', { name: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws 404 when the returning row is empty', async () => {
    stage([paradigmRow()]); // load
    stage([]); // update returning empty (concurrent delete)
    await expect(
      updateParadigm('p-1', { name: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('deleteParadigm', () => {
  it('returns void on success', async () => {
    stage([{ id: 'p-1' }]); // delete returning
    await expect(deleteParadigm('p-1')).resolves.toBeUndefined();
  });

  it('throws 404 when nothing was deleted', async () => {
    stage([]);
    await expect(deleteParadigm('p-missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('listLemmasUsingParadigm + countLemmasUsingParadigm', () => {
  it('returns the lemmas with a stem set', async () => {
    stage([
      { id: 'l-1', headword: 'बोलना', pos: 'VERB', language: 'hi', stem: 'बोल' },
    ]);
    const list = await listLemmasUsingParadigm('p-1');
    expect(list).toHaveLength(1);
    expect(list[0]!.headword).toBe('बोलना');
  });

  it('countLemmasUsingParadigm derives from the list', async () => {
    stage([
      { id: 'l-1', headword: 'a', pos: 'VERB', language: 'hi', stem: 'a' },
      { id: 'l-2', headword: 'b', pos: 'VERB', language: 'hi', stem: 'b' },
    ]);
    expect(await countLemmasUsingParadigm('p-1')).toBe(2);
  });
});

describe('createSlot', () => {
  it('verifies the paradigm exists and inserts the slot', async () => {
    stage([{ id: 'p-1' }]); // paradigm-exists check
    stage([slotRow({ id: 's-new' })]); // returning
    const row = await createSlot({
      paradigmId: 'p-1',
      slotKey: 'pres_hab_1sg',
      features: { Tense: 'Pres' },
      suffix: 'े',
      sortOrder: 20,
    });
    expect(row.id).toBe('s-new');
    const insert = calls.find((c) => c.kind === 'insert')!;
    expect(insert.values).toMatchObject({
      paradigmId: 'p-1',
      slotKey: 'pres_hab_1sg',
      sortOrder: 20,
    });
  });

  it('rejects a slot_key that violates the [a-z0-9_] shape', async () => {
    stage([{ id: 'p-1' }]);
    await expect(
      createSlot({
        paradigmId: 'p-1',
        slotKey: 'Bad-Key',
        features: {},
        suffix: '',
        sortOrder: 10,
      }),
    ).rejects.toThrowError(/slot_key must contain/);
  });

  it('rejects an empty slot_key', async () => {
    stage([{ id: 'p-1' }]);
    await expect(
      createSlot({
        paradigmId: 'p-1',
        slotKey: '   ',
        features: {},
        suffix: '',
        sortOrder: 10,
      }),
    ).rejects.toThrowError(/slot_key is required/);
  });

  it('rejects an over-long slot_key', async () => {
    stage([{ id: 'p-1' }]);
    await expect(
      createSlot({
        paradigmId: 'p-1',
        slotKey: 'a'.repeat(65),
        features: {},
        suffix: '',
        sortOrder: 10,
      }),
    ).rejects.toThrowError(/slot_key is too long/);
  });

  it('rejects an over-long suffix', async () => {
    stage([{ id: 'p-1' }]);
    await expect(
      createSlot({
        paradigmId: 'p-1',
        slotKey: 'ok',
        features: {},
        suffix: 'a'.repeat(65),
        sortOrder: 10,
      }),
    ).rejects.toThrowError(/suffix is too long/);
  });

  it('rejects an empty feature key or value', async () => {
    stage([{ id: 'p-1' }]);
    await expect(
      createSlot({
        paradigmId: 'p-1',
        slotKey: 'ok',
        features: { '': 'x' },
        suffix: '',
        sortOrder: 10,
      }),
    ).rejects.toThrowError(/non-empty keys/);
  });

  it('rejects a non-integer sortOrder', async () => {
    stage([{ id: 'p-1' }]);
    await expect(
      createSlot({
        paradigmId: 'p-1',
        slotKey: 'ok',
        features: {},
        suffix: '',
        sortOrder: 1.5,
      }),
    ).rejects.toThrowError(/integer/);
  });

  it('throws 404 when the parent paradigm does not exist', async () => {
    stage([]); // paradigm check
    await expect(
      createSlot({
        paradigmId: 'p-missing',
        slotKey: 'inf',
        features: {},
        suffix: '',
        sortOrder: 10,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('translates a Postgres unique-violation into 409', async () => {
    stage([{ id: 'p-1' }]); // paradigm check
    insertFailure = Object.assign(new Error('duplicate'), { code: '23505' });
    await expect(
      createSlot({
        paradigmId: 'p-1',
        slotKey: 'inf',
        features: {},
        suffix: '',
        sortOrder: 10,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rethrows non-unique-violation insert errors', async () => {
    stage([{ id: 'p-1' }]);
    insertFailure = Object.assign(new Error('boom'), { code: '99999' });
    await expect(
      createSlot({
        paradigmId: 'p-1',
        slotKey: 'inf',
        features: {},
        suffix: '',
        sortOrder: 10,
      }),
    ).rejects.toThrowError(/boom/);
  });
});

describe('updateSlot', () => {
  it('loads, merges, and writes the slot', async () => {
    stage([slotRow()]); // load
    stage([slotRow({ slotKey: 'inf2' })]); // returning
    const row = await updateSlot('s-1', { slotKey: 'inf2' });
    expect(row.slotKey).toBe('inf2');
  });

  it('preserves untouched fields by merging with current values', async () => {
    stage([slotRow({ suffix: 'ିବା' })]);
    stage([slotRow({ suffix: 'ିବା' })]);
    await updateSlot('s-1', { sortOrder: 99 });
    const update = calls.find((c) => c.kind === 'update')!;
    expect((update.set as { suffix: string; sortOrder: number }).suffix).toBe('ିବା');
    expect((update.set as { sortOrder: number }).sortOrder).toBe(99);
  });

  it('throws 404 when the slot does not exist', async () => {
    stage([]);
    await expect(updateSlot('s-missing', {})).rejects.toMatchObject({
      status: 404,
    });
  });

  it('translates a Postgres unique-violation into 409', async () => {
    stage([slotRow()]); // load
    const origUpdate = dbMock.update;
    dbMock.update = () => {
      const chain = origUpdate();
      chain.returning = vi.fn(() => {
        throw Object.assign(new Error('dup'), { code: '23505' });
      });
      return chain;
    };
    try {
      await expect(
        updateSlot('s-1', { slotKey: 'dup' }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      dbMock.update = origUpdate;
    }
  });

  it('rethrows non-unique-violation update errors', async () => {
    stage([slotRow()]);
    const origUpdate = dbMock.update;
    dbMock.update = () => {
      const chain = origUpdate();
      chain.returning = vi.fn(() => {
        throw Object.assign(new Error('boom'), { code: '99999' });
      });
      return chain;
    };
    try {
      await expect(updateSlot('s-1', { slotKey: 'x' })).rejects.toThrowError(
        /boom/,
      );
    } finally {
      dbMock.update = origUpdate;
    }
  });

  it('throws 404 when the returning is empty after a successful set', async () => {
    stage([slotRow()]); // load
    stage([]); // returning empty
    await expect(updateSlot('s-1', { slotKey: 'x' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('deleteSlot', () => {
  it('succeeds when a row was deleted', async () => {
    stage([{ id: 's-1' }]);
    await expect(deleteSlot('s-1')).resolves.toBeUndefined();
  });

  it('throws 404 when nothing was deleted', async () => {
    stage([]);
    await expect(deleteSlot('s-missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('saveAllParadigmChanges', () => {
  it('updates paradigm fields + every slot in one transaction', async () => {
    // exists check on paradigm
    stage([{ id: 'p-1' }]);
    // exists check on slot ids
    stage([
      { id: 's-1', paradigmId: 'p-1' },
      { id: 's-2', paradigmId: 'p-1' },
    ]);
    await saveAllParadigmChanges('p-1', {
      paradigm: {
        language: 'or',
        pos: 'VERB',
        name: 'Odia regular verb',
        description: 'updated',
      },
      slots: [
        { id: 's-1', slotKey: 'inf', features: { VerbForm: 'Inf' }, suffix: 'ିବା' },
        { id: 's-2', slotKey: 'past', features: {}, suffix: 'ିଲା' },
      ],
    });
    // paradigm update + one update per slot = 3 update calls
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(3);
    const slotUpdates = calls.filter((c) => c.kind === 'update').slice(1);
    expect((slotUpdates[0]!.set as { sortOrder: number }).sortOrder).toBe(10);
    expect((slotUpdates[1]!.set as { sortOrder: number }).sortOrder).toBe(20);
  });

  it('throws 404 when the paradigm is gone', async () => {
    stage([]); // paradigm exists check empty
    await expect(
      saveAllParadigmChanges('p-missing', {
        paradigm: { language: 'or', pos: 'VERB', name: 'x', description: null },
        slots: [],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws 404 when a slot id does not exist', async () => {
    stage([{ id: 'p-1' }]);
    stage([{ id: 's-1', paradigmId: 'p-1' }]); // only one of the two
    await expect(
      saveAllParadigmChanges('p-1', {
        paradigm: { language: 'or', pos: 'VERB', name: 'x', description: null },
        slots: [
          { id: 's-1', slotKey: 'a', features: {}, suffix: '', },
          { id: 's-2', slotKey: 'b', features: {}, suffix: '' },
        ],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws 400 when a slot belongs to a different paradigm', async () => {
    stage([{ id: 'p-1' }]);
    stage([{ id: 's-x', paradigmId: 'other-paradigm' }]);
    await expect(
      saveAllParadigmChanges('p-1', {
        paradigm: { language: 'or', pos: 'VERB', name: 'x', description: null },
        slots: [{ id: 's-x', slotKey: 'a', features: {}, suffix: '' }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rolls validation errors out before touching the DB', async () => {
    await expect(
      saveAllParadigmChanges('p-1', {
        paradigm: { language: 'xx', pos: 'VERB', name: 'x', description: null },
        slots: [],
      }),
    ).rejects.toBeInstanceOf(ParadigmValidationError);
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(0);
  });

  it('normalises a null description', async () => {
    stage([{ id: 'p-1' }]);
    await saveAllParadigmChanges('p-1', {
      paradigm: { language: 'or', pos: 'VERB', name: 'x', description: null },
      slots: [],
    });
    const update = calls.find((c) => c.kind === 'update')!;
    expect((update.set as { description: unknown }).description).toBeNull();
  });

  it('rethrows non-unique slot-update errors verbatim', async () => {
    stage([{ id: 'p-1' }]);
    stage([{ id: 's-1', paradigmId: 'p-1' }]);
    const origUpdate = dbMock.update;
    let firstCall = true;
    dbMock.update = () => {
      const chain = origUpdate();
      if (firstCall) {
        firstCall = false;
        return chain;
      }
      chain.where = vi.fn(() => {
        throw Object.assign(new Error('boom'), { code: '99999' });
      });
      return chain;
    };
    try {
      await expect(
        saveAllParadigmChanges('p-1', {
          paradigm: {
            language: 'or',
            pos: 'VERB',
            name: 'x',
            description: null,
          },
          slots: [{ id: 's-1', slotKey: 'a', features: {}, suffix: '' }],
        }),
      ).rejects.toThrowError(/boom/);
    } finally {
      dbMock.update = origUpdate;
    }
  });

  it('throws 409 when a slot update hits a unique-violation', async () => {
    stage([{ id: 'p-1' }]);
    stage([{ id: 's-1', paradigmId: 'p-1' }]);
    // Intercept the slot UPDATE chain to throw a unique violation.
    const origUpdate = dbMock.update;
    let firstCall = true;
    dbMock.update = () => {
      const chain = origUpdate();
      if (firstCall) {
        firstCall = false; // first update is the paradigm, let it pass
        return chain;
      }
      chain.where = vi.fn(() => {
        const err = Object.assign(new Error('dup'), { code: '23505' });
        throw err;
      });
      return chain;
    };
    try {
      await expect(
        saveAllParadigmChanges('p-1', {
          paradigm: {
            language: 'or',
            pos: 'VERB',
            name: 'x',
            description: null,
          },
          slots: [
            { id: 's-1', slotKey: 'dup', features: {}, suffix: '' },
          ],
        }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      dbMock.update = origUpdate;
    }
  });
});
