// @vitest-environment node
/**
 * Unit tests for the correction service (T-6.1).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Array<Record<string, unknown>> = [];
type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
  onConflictDoNothing: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => rows),
  values: vi.fn(() => chain),
  onConflictDoUpdate: vi.fn(() => chain),
  // The user_known_lemmas seed insert is a fire-and-forget upsert;
  // returning the chain keeps the mock awaitable when the
  // implementation `await`s the chain.
  onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
  returning: vi.fn(() => rows),
};
const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
};

vi.mock('./db/index.js', () => ({
  db: fakeDb,
  schema: {
    textTokens: { id: 'tt.id' },
    lemmas: { id: 'l.id' },
    tokenCorrections: {
      userId: 'tc.user_id',
      tokenId: 'tc.token_id',
    },
    userKnownLemmas: {
      userId: 'ukl.user_id',
      lemmaId: 'ukl.lemma_id',
    },
  },
}));

const { writeTokenCorrection, correctionsForTokens, CorrectionValidationError } =
  await import('./corrections.js');

function resetAll() {
  rows.length = 0;
  for (const fn of Object.values(chain))
    (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
}

beforeEach(resetAll);

describe('writeTokenCorrection', () => {
  it('upserts a pick_candidate row when the lemma + token both exist', async () => {
    // First select: token lookup → present.
    chain.limit.mockReturnValueOnce([{ id: 'tok-1' }]);
    // Second select: lemma lookup → present.
    chain.limit.mockReturnValueOnce([{ id: 'lem-2' }]);
    // returning() resolves the upsert on token_corrections.
    chain.returning.mockReturnValueOnce([
      {
        userId: 'u1',
        tokenId: 'tok-1',
        type: 'pick_candidate',
        chosenLemmaId: 'lem-2',
      },
    ]);
    const row = await writeTokenCorrection({
      userId: 'u1',
      tokenId: 'tok-1',
      type: 'pick_candidate',
      chosenLemmaId: 'lem-2',
    });
    expect(row.chosenLemmaId).toBe('lem-2');
    // Two inserts: token_corrections + user_known_lemmas seed (T-6.4).
    expect(fakeDb.insert).toHaveBeenCalledTimes(2);
  });

  it('rejects pick_candidate without a chosenLemmaId', async () => {
    await expect(
      writeTokenCorrection({
        userId: 'u1',
        tokenId: 'tok-1',
        type: 'pick_candidate',
      }),
    ).rejects.toBeInstanceOf(CorrectionValidationError);
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  it('rejects mark_proper_noun WITH a chosenLemmaId (the type IS the verdict)', async () => {
    await expect(
      writeTokenCorrection({
        userId: 'u1',
        tokenId: 'tok-1',
        type: 'mark_proper_noun',
        chosenLemmaId: 'lem-2',
      }),
    ).rejects.toBeInstanceOf(CorrectionValidationError);
  });

  it('returns 404 when the token does not exist', async () => {
    chain.limit.mockReturnValueOnce([]); // token lookup → empty
    await expect(
      writeTokenCorrection({
        userId: 'u1',
        tokenId: 'missing',
        type: 'mark_foreign',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 404 when chosen_lemma_id does not exist', async () => {
    chain.limit
      .mockReturnValueOnce([{ id: 'tok-1' }]) // token present
      .mockReturnValueOnce([]); // lemma absent
    await expect(
      writeTokenCorrection({
        userId: 'u1',
        tokenId: 'tok-1',
        type: 'pick_candidate',
        chosenLemmaId: 'no-such-lemma',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('writes a mark_* correction with chosen_lemma_id=null', async () => {
    chain.limit.mockReturnValueOnce([{ id: 'tok-9' }]);
    chain.returning.mockReturnValueOnce([
      {
        userId: 'u1',
        tokenId: 'tok-9',
        type: 'mark_not_a_word',
        chosenLemmaId: null,
      },
    ]);
    const row = await writeTokenCorrection({
      userId: 'u1',
      tokenId: 'tok-9',
      type: 'mark_not_a_word',
    });
    expect(row.chosenLemmaId).toBeNull();
    const insertArg = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertArg.chosenLemmaId).toBeNull();
    // T-6.4: mark_* corrections must NOT seed a user_known_lemmas
    // row — there's no chosen lemma to seed against.
    expect(chain.onConflictDoNothing).not.toHaveBeenCalled();
  });

  it('seeds a user_known_lemmas row on pick_candidate (T-6.4)', async () => {
    chain.limit
      .mockReturnValueOnce([{ id: 'tok-1' }])
      .mockReturnValueOnce([{ id: 'lem-2' }]);
    chain.returning.mockReturnValueOnce([
      {
        userId: 'u1',
        tokenId: 'tok-1',
        type: 'pick_candidate',
        chosenLemmaId: 'lem-2',
      },
    ]);
    await writeTokenCorrection({
      userId: 'u1',
      tokenId: 'tok-1',
      type: 'pick_candidate',
      chosenLemmaId: 'lem-2',
    });
    // Two inserts: token_corrections upsert + user_known_lemmas
    // seed (do-nothing on conflict).
    expect(fakeDb.insert).toHaveBeenCalledTimes(2);
    expect(chain.onConflictDoNothing).toHaveBeenCalledOnce();
    const seedArg = chain.values.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(seedArg.userId).toBe('u1');
    expect(seedArg.lemmaId).toBe('lem-2');
    expect(seedArg.status).toBe('learning');
  });
});

describe('correctionsForTokens', () => {
  it('returns an empty map when no token ids are passed', async () => {
    const m = await correctionsForTokens('u1', []);
    expect(m.size).toBe(0);
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  it('keys the result by tokenId', async () => {
    // The drizzle chain resolves on await; the fake `where` returns
    // the rows directly so the implementation can `await` without
    // calling .limit()/.returning().
    chain.where.mockReturnValueOnce([
      { userId: 'u1', tokenId: 't1', type: 'pick_candidate' },
      { userId: 'u1', tokenId: 't2', type: 'mark_foreign' },
    ]);
    const m = await correctionsForTokens('u1', ['t1', 't2', 't3']);
    expect(m.get('t1')?.type).toBe('pick_candidate');
    expect(m.get('t2')?.type).toBe('mark_foreign');
    expect(m.has('t3')).toBe(false);
  });
});
