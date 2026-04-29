// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock hoists its factory to the top of the file, so any value
// the factory references must come from vi.hoisted(), not a regular
// top-level const (which is initialized after the hoisted factory
// runs). The dynamic import at the bottom pulls in the module under
// test only after the mock is already active.
const queue: unknown[][] = [];
type ChainMock = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => void) => void;
};
const chain = {} as ChainMock;
chain.from = vi.fn(() => chain);
chain.where = vi.fn(() => chain);
chain.limit = vi.fn(() => chain);
chain.orderBy = vi.fn(() => chain);
chain.set = vi.fn(() => chain);
chain.values = vi.fn(() => chain);
chain.returning = vi.fn(() => chain);
chain.innerJoin = vi.fn(() => chain);
chain.then = (resolve) => {
  const v = queue.shift() ?? [];
  Promise.resolve(v).then(resolve);
};

const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  delete: vi.fn(() => chain),
  transaction: vi.fn(async (cb: (tx: typeof fakeDb) => Promise<void>) =>
    cb(fakeDb),
  ),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: {
    audioFiles: {
      id: 'af.id',
      textId: 'af.text_id',
    },
    audioAlignments: {
      audioFileId: 'aa.audio_file_id',
      tokenId: 'aa.token_id',
      startMs: 'aa.start_ms',
    },
    texts: { id: 't.id', ownerId: 't.owner_id' },
    textTokens: { id: 'tt.id' },
  },
}));

const { AlignmentError, findAlignmentAt, listAlignments, replaceAlignments } =
  await import('./alignments.js');

beforeEach(() => {
  queue.length = 0;
  for (const [k, v] of Object.entries(chain)) {
    if (k === 'then') continue;
    (v as ReturnType<typeof vi.fn>).mockClear();
  }
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fakeDb.delete.mockClear();
  fakeDb.transaction.mockClear();
});

const FIXTURE = [
  { tokenId: 't0', startMs: 0, endMs: 200 },
  { tokenId: 't1', startMs: 200, endMs: 400 },
  { tokenId: 't2', startMs: 500, endMs: 700 }, // gap before
  { tokenId: 't3', startMs: 700, endMs: 900 },
];

const OWNER = { id: 'u-owner', role: 'user' as const };
const ADMIN = { id: 'admin', role: 'admin' as const };
const STRANGER = { id: 'u-stranger', role: 'user' as const };

describe('findAlignmentAt', () => {
  it('returns the index of the alignment covering currentMs', () => {
    expect(findAlignmentAt(FIXTURE, 100)).toBe(0);
    expect(findAlignmentAt(FIXTURE, 350)).toBe(1);
    expect(findAlignmentAt(FIXTURE, 600)).toBe(2);
  });

  it('matches the boundary timestamp on a containing range', () => {
    // 200 = endMs of t0 = startMs of t1; both contain it. Either
    // index is acceptable; we just want a stable, defined hit.
    const idx = findAlignmentAt(FIXTURE, 200);
    expect(idx === 0 || idx === 1).toBe(true);
  });

  it('falls back to the most recent alignment when in a gap', () => {
    // 450 falls between t1.endMs=400 and t2.startMs=500.
    expect(findAlignmentAt(FIXTURE, 450)).toBe(1);
  });

  it('returns null when current is before the first alignment', () => {
    expect(findAlignmentAt(FIXTURE, -10)).toBeNull();
  });

  it('returns the last alignment when current is past the end', () => {
    expect(findAlignmentAt(FIXTURE, 99999)).toBe(3);
  });

  it('returns null on an empty list', () => {
    expect(findAlignmentAt([], 100)).toBeNull();
  });
});

describe('listAlignments', () => {
  it('projects DB rows down to the public shape', async () => {
    queue.push([
      {
        audioFileId: 'a1',
        tokenId: 't0',
        startMs: 0,
        endMs: 200,
        source: 'manual',
        createdAt: new Date(),
      },
      {
        audioFileId: 'a1',
        tokenId: 't1',
        startMs: 200,
        endMs: 400,
        source: 'manual',
        createdAt: new Date(),
      },
    ]);
    const out = await listAlignments('a1');
    expect(out).toEqual([
      { tokenId: 't0', startMs: 0, endMs: 200 },
      { tokenId: 't1', startMs: 200, endMs: 400 },
    ]);
    // The where + orderBy chain ran exactly once each.
    expect(chain.where).toHaveBeenCalledOnce();
    expect(chain.orderBy).toHaveBeenCalledOnce();
  });

  it('returns an empty array when nothing is staged', async () => {
    queue.push([]);
    const out = await listAlignments('a1');
    expect(out).toEqual([]);
  });
});

describe('replaceAlignments', () => {
  it('404s when the audio file is missing', async () => {
    queue.push([]);
    await expect(
      replaceAlignments({
        audioFileId: 'missing',
        alignments: [],
        source: 'manual',
        actor: OWNER,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner non-admin', async () => {
    queue.push([{ audioId: 'a1', ownerId: OWNER.id }]);
    await expect(
      replaceAlignments({
        audioFileId: 'a1',
        alignments: [],
        source: 'manual',
        actor: STRANGER,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('403s when the parent text is owner-less and the actor is not admin', async () => {
    queue.push([{ audioId: 'a1', ownerId: null }]);
    await expect(
      replaceAlignments({
        audioFileId: 'a1',
        alignments: [],
        source: 'manual',
        actor: OWNER,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects when one or more tokenIds do not exist', async () => {
    queue.push([{ audioId: 'a1', ownerId: OWNER.id }]);
    queue.push([{ id: 't0' }]); // only one of two tokens present
    await expect(
      replaceAlignments({
        audioFileId: 'a1',
        alignments: [
          { tokenId: 't0', startMs: 0, endMs: 100 },
          { tokenId: 't-ghost', startMs: 100, endMs: 200 },
        ],
        source: 'manual',
        actor: OWNER,
      }),
    ).rejects.toThrow(/tokenIds are missing/);
    // Token-validation runs BEFORE the transaction.
    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it('replaces inside a transaction and returns the new count', async () => {
    queue.push([{ audioId: 'a1', ownerId: OWNER.id }]); // audio + ownership
    queue.push([{ id: 't0' }, { id: 't1' }]); // token validation
    queue.push([]); // tx delete
    queue.push([]); // tx insert
    const n = await replaceAlignments({
      audioFileId: 'a1',
      alignments: [
        { tokenId: 't0', startMs: 0, endMs: 200 },
        { tokenId: 't1', startMs: 200, endMs: 400 },
      ],
      source: 'manual',
      actor: OWNER,
    });
    expect(n).toBe(2);
    expect(fakeDb.transaction).toHaveBeenCalledOnce();
    expect(fakeDb.delete).toHaveBeenCalledOnce();
    expect(fakeDb.insert).toHaveBeenCalledOnce();
    const valuesArg = chain.values.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;
    expect(valuesArg).toHaveLength(2);
    expect(valuesArg[0]?.source).toBe('manual');
  });

  it('skips token validation + insert when the new set is empty (clear-all path)', async () => {
    queue.push([{ audioId: 'a1', ownerId: OWNER.id }]);
    queue.push([]); // tx delete only
    const n = await replaceAlignments({
      audioFileId: 'a1',
      alignments: [],
      source: 'manual',
      actor: OWNER,
    });
    expect(n).toBe(0);
    expect(fakeDb.delete).toHaveBeenCalledOnce();
    expect(fakeDb.insert).not.toHaveBeenCalled();
  });

  it('lets an admin replace alignments on a text they do not own', async () => {
    queue.push([{ audioId: 'a1', ownerId: OWNER.id }]); // owned by OWNER
    queue.push([{ id: 't0' }]);
    queue.push([]); // tx delete
    queue.push([]); // tx insert
    const n = await replaceAlignments({
      audioFileId: 'a1',
      alignments: [{ tokenId: 't0', startMs: 0, endMs: 100 }],
      source: 'whisper',
      actor: ADMIN,
    });
    expect(n).toBe(1);
    const valuesArg = chain.values.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;
    expect(valuesArg[0]?.source).toBe('whisper');
  });

  it('dedups tokenIds before validating (same id twice is one lookup)', async () => {
    queue.push([{ audioId: 'a1', ownerId: OWNER.id }]);
    queue.push([{ id: 't0' }]); // single row returned even though we pass tokenId twice
    queue.push([]); // tx delete
    queue.push([]); // tx insert
    const n = await replaceAlignments({
      audioFileId: 'a1',
      alignments: [
        { tokenId: 't0', startMs: 0, endMs: 100 },
        { tokenId: 't0', startMs: 100, endMs: 200 },
      ],
      source: 'manual',
      actor: OWNER,
    });
    // Both rows still get inserted — replaceAlignments doesn't dedup
    // alignment rows themselves, only the validation lookup.
    expect(n).toBe(2);
    const valuesArg = chain.values.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;
    expect(valuesArg).toHaveLength(2);
  });
});

void AlignmentError;
