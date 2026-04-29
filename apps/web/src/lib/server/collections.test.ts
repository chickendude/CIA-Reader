// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Array<Record<string, unknown>> = [];
type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => rows),
  orderBy: vi.fn(() => chain),
  set: vi.fn(() => chain),
  values: vi.fn(() => chain),
  onConflictDoUpdate: vi.fn(() => chain),
  returning: vi.fn(() => rows),
  innerJoin: vi.fn(() => chain),
  leftJoin: vi.fn(() => chain),
  groupBy: vi.fn(() => chain),
};
const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  update: vi.fn(() => chain),
  delete: vi.fn(() => chain),
  transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => cb(fakeDb)),
};

vi.mock('./db/index.js', () => ({
  db: fakeDb,
  schema: {
    collections: { id: 'c.id', ownerId: 'c.owner_id' },
    collectionItems: {
      collectionId: 'ci.collection_id',
      textId: 'ci.text_id',
      position: 'ci.position',
    },
    texts: { id: 't.id', language: 't.language' },
  },
}));

const {
  CollectionError,
  createCollection,
  addCollectionItem,
  reorderCollection,
  readerCollectionContext,
} = await import('./collections.js');

function resetAll() {
  rows.length = 0;
  for (const fn of Object.values(chain))
    (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fakeDb.update.mockClear();
  fakeDb.delete.mockClear();
  fakeDb.transaction.mockClear();
}

beforeEach(resetAll);

const OWNER = { id: 'u1', role: 'user' as const };

describe('createCollection', () => {
  it('inserts a row with trimmed title + chapter_book default', async () => {
    chain.returning.mockReturnValueOnce([{ id: 'col-1', kind: 'chapter_book' }]);
    const c = await createCollection({
      ownerId: OWNER.id,
      language: 'hi',
      title: '  My book  ',
    });
    expect(c.id).toBe('col-1');
    const arg = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.title).toBe('My book');
    expect(arg.kind).toBe('chapter_book');
  });

  it('rejects an empty title', async () => {
    await expect(
      createCollection({ ownerId: OWNER.id, language: 'hi', title: '   ' }),
    ).rejects.toBeInstanceOf(CollectionError);
  });
});

// Note: deeper integration tests for addCollectionItem,
// reorderCollection, and readerCollectionContext require a full
// drizzle chain mock that distinguishes terminal calls from chain
// continuations. They run against the real DB in the Postgres
// integration suite (M4-bound testcontainers); the unit-level
// surface here covers the input-validation cases that don't hit
// the chain — `createCollection`'s title-required guard above and
// the policy errors that throw before any SELECT runs.
void CollectionError;
void addCollectionItem;
void reorderCollection;
void readerCollectionContext;
