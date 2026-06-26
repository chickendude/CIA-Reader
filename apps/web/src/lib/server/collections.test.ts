// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drizzle's chains return `this` from every builder method and resolve
// to an array of rows on await. We mock that with a single chain object
// whose builder methods return itself and whose `then` shifts the next
// staged result off `queue`. Tests stage one entry per *await* — most
// service calls await the chain 1–4 times.
const queue: unknown[][] = [];
type ChainMock = {
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
  then: (resolve: (v: unknown) => void) => void;
};
const chain = {} as ChainMock;
chain.from = vi.fn(() => chain);
chain.where = vi.fn(() => chain);
chain.limit = vi.fn(() => chain);
chain.orderBy = vi.fn(() => chain);
chain.set = vi.fn(() => chain);
chain.values = vi.fn(() => chain);
chain.onConflictDoUpdate = vi.fn(() => chain);
chain.returning = vi.fn(() => chain);
chain.innerJoin = vi.fn(() => chain);
chain.leftJoin = vi.fn(() => chain);
chain.groupBy = vi.fn(() => chain);
chain.then = (resolve) => {
  const v = queue.shift() ?? [];
  Promise.resolve(v).then(resolve);
};

const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  update: vi.fn(() => chain),
  delete: vi.fn(() => chain),
  transaction: vi.fn(async (cb: (tx: typeof fakeDb) => Promise<void>) =>
    cb(fakeDb),
  ),
};

vi.mock('./db/index.js', () => ({
  db: fakeDb,
  schema: {
    collections: {
      id: 'c.id',
      ownerId: 'c.owner_id',
      visibility: 'c.visibility',
      language: 'c.language',
      updatedAt: 'c.updated_at',
    },
    collectionItems: {
      collectionId: 'ci.collection_id',
      textId: 'ci.text_id',
      position: 'ci.position',
    },
    collectionShares: {
      collectionId: 'cs.collection_id',
      sharedWithUserId: 'cs.shared_with_user_id',
    },
    texts: { id: 't.id', language: 't.language', title: 't.title' },
    textChapters: { textId: 'tc.text_id', tokenCount: 'tc.token_count' },
    userTextProgress: {
      userId: 'utp.user_id',
      textId: 'utp.text_id',
      updatedAt: 'utp.updated_at',
    },
    users: { id: 'u.id' },
  },
}));

// listCollectionsForUser bulk-decorates each row with the owner's
// comprehension; stub it so these tests stay focused on the join/openTextId
// logic and don't need to stage the comprehension query. The fake echoes a
// deterministic pct per collection id so the threading can be asserted.
const estimatedComprehensionForCollections = vi.fn(
  async (_userId: string, ids: string[]) =>
    new Map(ids.map((id, i) => [id, i === 0 ? 64 : null])),
);
vi.mock('./learning-stats.js', () => ({
  estimatedComprehensionForCollections: (...a: unknown[]) =>
    estimatedComprehensionForCollections(...(a as [string, string[]])),
}));

const {
  CollectionError,
  createCollection,
  createChapterBookCollection,
  updateCollection,
  deleteCollection,
  addCollectionItem,
  removeCollectionItem,
  reorderCollection,
  listCollectionsForUser,
  listOfficialCollections,
  loadCollectionDetail,
  readerCollectionContext,
  grantCollectionShare,
  revokeCollectionShare,
  listCollectionShares,
  viewerHasCollectionShareForText,
  bookProgressPct,
} = await import('./collections.js');

describe('bookProgressPct', () => {
  it('token-weights chapters before the current one + the current fraction', () => {
    // ch0=100 tokens, ch1=300 tokens; on ch1 (index 1) at 50%.
    const chapters = [
      { position: 0, tokens: 100 },
      { position: 1, tokens: 300 },
    ];
    // before=100, current=300*0.5=150 → 250/400 = 63% (NOT the equal-weight 75%).
    expect(bookProgressPct(chapters, { position: 1, pctRead: 50 })).toBe(63);
  });

  it('falls back to even weighting when token counts are unknown', () => {
    const chapters = [
      { position: 0, tokens: 0 },
      { position: 1, tokens: 0 },
    ];
    // (1 + 0.5) / 2 = 75%.
    expect(bookProgressPct(chapters, { position: 1, pctRead: 50 })).toBe(75);
  });

  it('is 0 with no progress', () => {
    expect(bookProgressPct([{ position: 0, tokens: 10 }], undefined)).toBe(0);
  });
});

function resetAll() {
  queue.length = 0;
  for (const [k, v] of Object.entries(chain)) {
    if (k === 'then') continue;
    (v as ReturnType<typeof vi.fn>).mockClear();
  }
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fakeDb.update.mockClear();
  fakeDb.delete.mockClear();
  fakeDb.transaction.mockClear();
  estimatedComprehensionForCollections.mockClear();
}

beforeEach(resetAll);

const OWNER = { id: 'u1', role: 'user' as const };
const ADMIN = { id: 'admin', role: 'admin' as const };
const STRANGER = { id: 'u2', role: 'user' as const };

const baseCollection = {
  id: 'col-1',
  ownerId: OWNER.id,
  language: 'hi',
  kind: 'chapter_book',
  title: 'Book',
  description: null,
  coverUrl: null,
  visibility: 'private',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createCollection', () => {
  it('inserts a row with trimmed title + chapter_book default', async () => {
    queue.push([{ ...baseCollection, id: 'col-1' }]);
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

  it('honors a non-default kind + trims description / cover', async () => {
    queue.push([{ ...baseCollection, kind: 'course' }]);
    await createCollection({
      ownerId: OWNER.id,
      language: 'hi',
      title: 't',
      kind: 'course',
      description: '  desc  ',
      coverUrl: '  https://x/y.png  ',
    });
    const arg = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.kind).toBe('course');
    expect(arg.description).toBe('desc');
    expect(arg.coverUrl).toBe('https://x/y.png');
  });

  it('coerces blank description / cover to null', async () => {
    queue.push([{ ...baseCollection }]);
    await createCollection({
      ownerId: OWNER.id,
      language: 'hi',
      title: 't',
      description: '   ',
      coverUrl: '',
    });
    const arg = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.description).toBeNull();
    expect(arg.coverUrl).toBeNull();
  });

  it('rejects an empty title', async () => {
    await expect(
      createCollection({ ownerId: OWNER.id, language: 'hi', title: '   ' }),
    ).rejects.toBeInstanceOf(CollectionError);
  });

  it('throws when the insert returns no row', async () => {
    queue.push([]);
    await expect(
      createCollection({ ownerId: OWNER.id, language: 'hi', title: 't' }),
    ).rejects.toThrow(/insert returned no row/);
  });
});

describe('createChapterBookCollection', () => {
  /** Per-chapter draft used across the happy-path tests. */
  const draft = (idx: number, title: string | null = null) => ({
    idx,
    title,
    body: `body of chapter ${idx}.`,
    tokenCount: 4,
  });

  it('creates collection + N texts + N items + N nlp jobs in one transaction', async () => {
    // Queue stages: collection insert, then per chapter (text, textChapter,
    // collectionItem, nlpJob) × 2 = 9 entries.
    queue.push([{ ...baseCollection, id: 'col-1' }]);
    queue.push([{ id: 'text-1', ownerId: OWNER.id, language: 'hi' }]);
    queue.push([{ id: 'chap-1', textId: 'text-1', idx: 0 }]);
    queue.push([{ collectionId: 'col-1', textId: 'text-1', position: 0 }]);
    queue.push([{ id: 'job-1', textId: 'text-1', status: 'pending' }]);
    queue.push([{ id: 'text-2', ownerId: OWNER.id, language: 'hi' }]);
    queue.push([{ id: 'chap-2', textId: 'text-2', idx: 0 }]);
    queue.push([{ collectionId: 'col-1', textId: 'text-2', position: 1 }]);
    queue.push([{ id: 'job-2', textId: 'text-2', status: 'pending' }]);

    const result = await createChapterBookCollection({
      ownerId: OWNER.id,
      language: 'hi',
      title: 'My book',
      sourceType: 'epub',
      chapters: [draft(0, 'Chapter One'), draft(1, 'Chapter Two')],
    });

    expect(result.collection.id).toBe('col-1');
    expect(result.texts.map((t) => t.id)).toEqual(['text-1', 'text-2']);
    expect(result.items.map((i) => i.position)).toEqual([0, 1]);
    expect(fakeDb.transaction).toHaveBeenCalledOnce();
  });

  it('uses each chapter draft title, falling back to "Untitled"', async () => {
    queue.push([{ ...baseCollection, id: 'col-1' }]);
    // chapter without title → fallback "Untitled"
    queue.push([{ id: 'text-1' }]);
    queue.push([{ id: 'chap-1' }]);
    queue.push([{ collectionId: 'col-1', textId: 'text-1', position: 0 }]);
    queue.push([{ id: 'job-1' }]);
    // chapter with title → preserved verbatim
    queue.push([{ id: 'text-2' }]);
    queue.push([{ id: 'chap-2' }]);
    queue.push([{ collectionId: 'col-1', textId: 'text-2', position: 1 }]);
    queue.push([{ id: 'job-2' }]);

    await createChapterBookCollection({
      ownerId: OWNER.id,
      language: 'hi',
      title: 'My book',
      sourceType: 'zip',
      chapters: [draft(0, null), draft(1, 'Real Title')],
    });

    // chain.values is called for every insert. The text inserts are
    // 2 and 6 in zero-indexed order: collection, text1, chap1, item1,
    // job1, text2, chap2, item2, job2.
    const textInserts = chain.values.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((v) => v.sourceType === 'zip');
    expect(textInserts).toHaveLength(2);
    expect(textInserts[0]!.title).toBe('Untitled');
    expect(textInserts[1]!.title).toBe('Real Title');
  });

  it('prepends the chapter title to the body so NLP tokenizes it for lookup', async () => {
    queue.push([{ ...baseCollection, id: 'col-1' }]);
    queue.push([{ id: 'text-1' }]);
    queue.push([{ id: 'chap-1' }]);
    queue.push([{ collectionId: 'col-1', textId: 'text-1', position: 0 }]);
    queue.push([{ id: 'job-1' }]);

    await createChapterBookCollection({
      ownerId: OWNER.id,
      language: 'hi',
      title: 'Book',
      sourceType: 'epub',
      chapters: [
        { idx: 0, title: 'Compound Effect', body: 'Body content here.', tokenCount: 3 },
      ],
    });

    // text_chapters insert is the only `.values()` call with a
    // `body` field. Pull it out and check the body now leads with
    // the title separated by a blank line.
    const chapterInsert = chain.values.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((v) => typeof v.body === 'string');
    expect(chapterInsert).toBeDefined();
    expect(chapterInsert!.body).toBe('Compound Effect\n\nBody content here.');
    // tokenCount should reflect the title's words too, not just the
    // original body's.
    expect(chapterInsert!.tokenCount).toBeGreaterThan(3);
  });

  it('does NOT duplicate the title when the body already starts with it', async () => {
    // Repro: an EPUB whose `<h1>Title</h1>` survived htmlToText and
    // shows up as the body's first paragraph. Without dedup, the
    // stored body would be `Title\n\nTitle\n\n…` and the reader
    // would render the heading twice.
    queue.push([{ ...baseCollection, id: 'col-1' }]);
    queue.push([{ id: 'text-1' }]);
    queue.push([{ id: 'chap-1' }]);
    queue.push([{ collectionId: 'col-1', textId: 'text-1', position: 0 }]);
    queue.push([{ id: 'job-1' }]);

    await createChapterBookCollection({
      ownerId: OWNER.id,
      language: 'hi',
      title: 'Book',
      sourceType: 'epub',
      chapters: [
        {
          idx: 0,
          title: 'Compound Effect',
          body: 'Compound Effect\n\nReal opening paragraph.',
          tokenCount: 5,
        },
      ],
    });

    const chapterInsert = chain.values.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((v) => typeof v.body === 'string');
    expect(chapterInsert).toBeDefined();
    // No duplicated heading — the body stays as-is (normalized).
    expect(chapterInsert!.body).toBe(
      'Compound Effect\n\nReal opening paragraph.',
    );
  });

  it('rejects an empty chapter list', async () => {
    await expect(
      createChapterBookCollection({
        ownerId: OWNER.id,
        language: 'hi',
        title: 'X',
        sourceType: 'epub',
        chapters: [],
      }),
    ).rejects.toBeInstanceOf(CollectionError);
  });

  it('rejects a blank title', async () => {
    await expect(
      createChapterBookCollection({
        ownerId: OWNER.id,
        language: 'hi',
        title: '   ',
        sourceType: 'epub',
        chapters: [draft(0)],
      }),
    ).rejects.toBeInstanceOf(CollectionError);
  });
});

describe('updateCollection', () => {
  it('rejects when the collection is missing', async () => {
    queue.push([]); // loadCollection: empty
    await expect(
      updateCollection({
        collectionId: 'missing',
        actor: OWNER,
        patch: { title: 'x' },
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a non-owner non-admin', async () => {
    queue.push([baseCollection]); // loadCollection
    await expect(
      updateCollection({
        collectionId: 'col-1',
        actor: STRANGER,
        patch: { title: 'x' },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a non-admin trying to mark a collection official', async () => {
    queue.push([baseCollection]);
    await expect(
      updateCollection({
        collectionId: 'col-1',
        actor: OWNER,
        patch: { visibility: 'official' },
      }),
    ).rejects.toThrow(/only admins can mark a collection official/);
  });

  it('rejects a non-admin owner editing an already-official collection', async () => {
    queue.push([{ ...baseCollection, visibility: 'official' }]);
    await expect(
      updateCollection({
        collectionId: 'col-1',
        actor: OWNER,
        patch: { title: 'rename attempt' },
      }),
    ).rejects.toThrow(/official collection/);
  });

  it('writes the merged patch + updatedAt', async () => {
    queue.push([baseCollection]); // loadCollection
    queue.push([{ ...baseCollection, title: 'New' }]); // returning
    const updated = await updateCollection({
      collectionId: 'col-1',
      actor: OWNER,
      patch: {
        title: '  New  ',
        description: '  d  ',
        coverUrl: '  ',
        kind: 'anthology',
      },
    });
    expect(updated.title).toBe('New');
    const setArg = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.title).toBe('New');
    expect(setArg.description).toBe('d');
    expect(setArg.coverUrl).toBeNull();
    expect(setArg.kind).toBe('anthology');
    expect(setArg.updatedAt).toBeInstanceOf(Date);
  });

  it('lets an admin promote a collection to official', async () => {
    queue.push([baseCollection]);
    queue.push([{ ...baseCollection, visibility: 'official' }]);
    const updated = await updateCollection({
      collectionId: 'col-1',
      actor: ADMIN,
      patch: { visibility: 'official' },
    });
    expect(updated.visibility).toBe('official');
  });

  it('throws when the update returns no row', async () => {
    queue.push([baseCollection]);
    queue.push([]); // returning empty
    await expect(
      updateCollection({
        collectionId: 'col-1',
        actor: OWNER,
        patch: { title: 'x' },
      }),
    ).rejects.toThrow(/update returned no row/);
  });
});

describe('deleteCollection', () => {
  it('404s when the collection is missing', async () => {
    queue.push([]);
    await expect(
      deleteCollection({ collectionId: 'missing', actor: OWNER }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner', async () => {
    queue.push([baseCollection]);
    await expect(
      deleteCollection({ collectionId: 'col-1', actor: STRANGER }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('issues a delete for the owner of a non-chapter-book collection', async () => {
    queue.push([{ ...baseCollection, kind: 'course' }]); // loadCollection
    queue.push([]); // delete().where() resolution
    await deleteCollection({ collectionId: 'col-1', actor: OWNER });
    expect(fakeDb.delete).toHaveBeenCalledOnce();
    // Single tx-less delete — non-chapter-book path.
    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it('cascades to member texts when deleting a chapter_book', async () => {
    queue.push([{ ...baseCollection, kind: 'chapter_book' }]); // loadCollection
    queue.push([{ textId: 'text-1' }, { textId: 'text-2' }, { textId: 'text-3' }]); // member ids
    queue.push([]); // tx delete collection
    queue.push([]); // tx delete texts
    await deleteCollection({ collectionId: 'col-1', actor: OWNER });
    expect(fakeDb.transaction).toHaveBeenCalledOnce();
    // Two deletes inside the tx: collection + texts.
    expect(fakeDb.delete).toHaveBeenCalledTimes(2);
  });

  it('skips the texts-delete when the chapter book is empty', async () => {
    queue.push([{ ...baseCollection, kind: 'chapter_book' }]);
    queue.push([]); // no member ids
    queue.push([]); // tx delete collection
    await deleteCollection({ collectionId: 'col-1', actor: OWNER });
    expect(fakeDb.transaction).toHaveBeenCalledOnce();
    expect(fakeDb.delete).toHaveBeenCalledTimes(1);
  });
});

describe('addCollectionItem', () => {
  it('404s when the collection is missing', async () => {
    queue.push([]);
    await expect(
      addCollectionItem({
        collectionId: 'missing',
        actor: OWNER,
        textId: 't1',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner', async () => {
    queue.push([baseCollection]);
    await expect(
      addCollectionItem({ collectionId: 'col-1', actor: STRANGER, textId: 't1' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('404s when the text is missing', async () => {
    queue.push([baseCollection]); // loadCollection
    queue.push([]); // text lookup
    await expect(
      addCollectionItem({ collectionId: 'col-1', actor: OWNER, textId: 't-missing' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a text whose language differs from the collection', async () => {
    queue.push([baseCollection]); // hi collection
    queue.push([{ id: 't1', language: 'mr' }]);
    await expect(
      addCollectionItem({ collectionId: 'col-1', actor: OWNER, textId: 't1' }),
    ).rejects.toThrow(/does not match collection/);
  });

  it('appends at MAX(position)+1 when no position is given', async () => {
    queue.push([baseCollection]);
    queue.push([{ id: 't1', language: 'hi' }]);
    queue.push([{ max: 4 }]); // MAX(position)
    queue.push([
      { collectionId: 'col-1', textId: 't1', position: 5, createdAt: new Date() },
    ]);
    const item = await addCollectionItem({
      collectionId: 'col-1',
      actor: OWNER,
      textId: 't1',
    });
    expect(item.position).toBe(5);
    const valuesArg = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.position).toBe(5);
  });

  it('starts at 0 for the first item (MAX returns -1)', async () => {
    queue.push([baseCollection]);
    queue.push([{ id: 't1', language: 'hi' }]);
    queue.push([{ max: -1 }]);
    queue.push([
      { collectionId: 'col-1', textId: 't1', position: 0, createdAt: new Date() },
    ]);
    await addCollectionItem({ collectionId: 'col-1', actor: OWNER, textId: 't1' });
    const valuesArg = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.position).toBe(0);
  });

  it('honors an explicit position + skips the MAX query', async () => {
    queue.push([baseCollection]);
    queue.push([{ id: 't1', language: 'hi' }]);
    // Note: no MAX query staged — the service must skip it.
    queue.push([
      { collectionId: 'col-1', textId: 't1', position: 2, createdAt: new Date() },
    ]);
    const item = await addCollectionItem({
      collectionId: 'col-1',
      actor: OWNER,
      textId: 't1',
      position: 2,
    });
    expect(item.position).toBe(2);
  });

  it('throws when the insert returns no row', async () => {
    queue.push([baseCollection]);
    queue.push([{ id: 't1', language: 'hi' }]);
    queue.push([]); // returning empty (after onConflictDoUpdate)
    await expect(
      addCollectionItem({
        collectionId: 'col-1',
        actor: OWNER,
        textId: 't1',
        position: 0,
      }),
    ).rejects.toThrow(/insert returned no row/);
  });
});

describe('removeCollectionItem', () => {
  it('404s when the collection is missing', async () => {
    queue.push([]);
    await expect(
      removeCollectionItem({ collectionId: 'missing', actor: OWNER, textId: 't1' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner', async () => {
    queue.push([baseCollection]);
    await expect(
      removeCollectionItem({ collectionId: 'col-1', actor: STRANGER, textId: 't1' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('issues a delete for the owner', async () => {
    queue.push([baseCollection]);
    queue.push([]);
    await removeCollectionItem({
      collectionId: 'col-1',
      actor: OWNER,
      textId: 't1',
    });
    expect(fakeDb.delete).toHaveBeenCalledOnce();
  });
});

describe('reorderCollection', () => {
  it('404s when the collection is missing', async () => {
    queue.push([]);
    await expect(
      reorderCollection({ collectionId: 'missing', actor: OWNER, textIds: [] }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner', async () => {
    queue.push([baseCollection]);
    await expect(
      reorderCollection({
        collectionId: 'col-1',
        actor: STRANGER,
        textIds: [],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a partial reorder (mismatched sizes)', async () => {
    queue.push([baseCollection]); // loadCollection
    queue.push([
      { collectionId: 'col-1', textId: 'a', position: 0 },
      { collectionId: 'col-1', textId: 'b', position: 1 },
    ]); // existing items
    await expect(
      reorderCollection({
        collectionId: 'col-1',
        actor: OWNER,
        textIds: ['a'], // missing 'b'
      }),
    ).rejects.toThrow(/must include every member/);
  });

  it('rejects a reorder that swaps in an unknown id', async () => {
    queue.push([baseCollection]);
    queue.push([
      { collectionId: 'col-1', textId: 'a', position: 0 },
      { collectionId: 'col-1', textId: 'b', position: 1 },
    ]);
    await expect(
      reorderCollection({
        collectionId: 'col-1',
        actor: OWNER,
        textIds: ['a', 'c'], // 'c' wasn't a member
      }),
    ).rejects.toThrow(/missing text/);
  });

  it('rewrites positions inside a transaction and returns the new order', async () => {
    queue.push([baseCollection]); // loadCollection
    queue.push([
      { collectionId: 'col-1', textId: 'a', position: 0 },
      { collectionId: 'col-1', textId: 'b', position: 1 },
    ]); // existing items
    // The transaction body issues N updates; each update().set().where()
    // is awaited and gets an empty array result.
    queue.push([]); // tx update for 'b'
    queue.push([]); // tx update for 'a'
    queue.push([
      { collectionId: 'col-1', textId: 'b', position: 0, createdAt: new Date() },
      { collectionId: 'col-1', textId: 'a', position: 1, createdAt: new Date() },
    ]); // final ordered SELECT
    const result = await reorderCollection({
      collectionId: 'col-1',
      actor: OWNER,
      textIds: ['b', 'a'],
    });
    expect(fakeDb.transaction).toHaveBeenCalledOnce();
    expect(result.map((r) => r.textId)).toEqual(['b', 'a']);
  });
});

describe('listCollectionsForUser', () => {
  it('returns the joined rows the chain produces', async () => {
    queue.push([
      { collection: baseCollection, textCount: 3 },
      { collection: { ...baseCollection, id: 'col-2' }, textCount: 0 },
    ]);
    const out = await listCollectionsForUser(OWNER.id);
    expect(out).toHaveLength(2);
    expect(out[0]?.textCount).toBe(3);
    // Comprehension is bulk-decorated onto each row (null when none of the
    // book's texts have tokens yet).
    expect(estimatedComprehensionForCollections).toHaveBeenCalledWith(OWNER.id, [
      baseCollection.id,
      'col-2',
    ]);
    expect(out.map((r) => r.estimatedComprehensionPct)).toEqual([64, null]);
  });

  it('openTextId resumes the most-recently-read chapter', async () => {
    queue.push([{ collection: baseCollection, textCount: 2 }]); // collections + count
    queue.push([
      { collectionId: baseCollection.id, textId: 'text-b', updatedAt: new Date('2026-05-02') },
      { collectionId: baseCollection.id, textId: 'text-a', updatedAt: new Date('2026-05-01') },
    ]); // progress
    queue.push([{ collectionId: baseCollection.id, textId: 'text-a' }]); // first chapter
    const out = await listCollectionsForUser(OWNER.id);
    expect(out[0]?.openTextId).toBe('text-b');
  });

  it('openTextId falls back to the first chapter when not started', async () => {
    queue.push([{ collection: baseCollection, textCount: 2 }]);
    queue.push([]); // no progress
    queue.push([{ collectionId: baseCollection.id, textId: 'text-a' }]); // first chapter
    const out = await listCollectionsForUser(OWNER.id);
    expect(out[0]?.openTextId).toBe('text-a');
  });
});

describe('listOfficialCollections', () => {
  it('returns rows when no language filter is given', async () => {
    queue.push([{ collection: { ...baseCollection, visibility: 'official' }, textCount: 5 }]);
    const out = await listOfficialCollections();
    expect(out).toHaveLength(1);
    expect(out[0]?.collection.visibility).toBe('official');
  });

  it('still returns rows when filtering by language', async () => {
    queue.push([{ collection: { ...baseCollection, visibility: 'official' }, textCount: 1 }]);
    const out = await listOfficialCollections('hi');
    expect(out).toHaveLength(1);
  });
});

describe('loadCollectionDetail', () => {
  it('returns null when the collection is missing', async () => {
    queue.push([]);
    const out = await loadCollectionDetail('missing');
    expect(out).toBeNull();
  });

  it('returns the collection + ordered items', async () => {
    queue.push([baseCollection]); // loadCollection
    queue.push([
      { position: 0, text: { id: 't1', language: 'hi', title: 'A' } },
      { position: 1, text: { id: 't2', language: 'hi', title: 'B' } },
    ]);
    const out = await loadCollectionDetail('col-1');
    expect(out?.collection.id).toBe('col-1');
    expect(out?.items.map((i) => i.text.id)).toEqual(['t1', 't2']);
  });
});

describe('readerCollectionContext', () => {
  it('returns null when the text belongs to no collection', async () => {
    queue.push([]); // hit query empty
    const out = await readerCollectionContext('t-orphan');
    expect(out).toBeNull();
  });

  it('reports prev/next around a middle text', async () => {
    queue.push([{ collection: baseCollection, position: 1 }]); // hit
    queue.push([
      { textId: 'a', position: 0, title: 'One', tokenCount: 100 },
      { textId: 'b', position: 1, title: 'Two', tokenCount: 200 },
      { textId: 'c', position: 2, title: 'Three', tokenCount: 300 },
    ]); // siblings
    const out = await readerCollectionContext('b');
    expect(out?.prevTextId).toBe('a');
    expect(out?.nextTextId).toBe('c');
    expect(out?.totalCount).toBe(3);
    expect(out?.position).toBe(1);
  });

  it('null prev for the first text + null next for the last', async () => {
    queue.push([{ collection: baseCollection, position: 0 }]); // first
    queue.push([
      { textId: 'a', position: 0, title: 'One', tokenCount: 100 },
      { textId: 'b', position: 1, title: 'Two', tokenCount: 200 },
    ]);
    const first = await readerCollectionContext('a');
    expect(first?.prevTextId).toBeNull();
    expect(first?.nextTextId).toBe('b');

    queue.push([{ collection: baseCollection, position: 1 }]); // last
    queue.push([
      { textId: 'a', position: 0, title: 'One', tokenCount: 100 },
      { textId: 'b', position: 1, title: 'Two', tokenCount: 200 },
    ]);
    const last = await readerCollectionContext('b');
    expect(last?.prevTextId).toBe('a');
    expect(last?.nextTextId).toBeNull();
  });

  it('surfaces the sibling chapter list with titles + token sums for the TOC', async () => {
    queue.push([{ collection: baseCollection, position: 0 }]); // hit
    queue.push([
      { textId: 'a', position: 0, title: 'Prologue', tokenCount: 120 },
      { textId: 'b', position: 1, title: '  ', tokenCount: 0 },
      { textId: 'c', position: 2, title: 'Finale', tokenCount: 340 },
    ]); // siblings
    const out = await readerCollectionContext('a');
    expect(out?.chapters).toEqual([
      { textId: 'a', position: 0, title: 'Prologue', tokenCount: 120 },
      // Blank title falls back to 'Untitled'.
      { textId: 'b', position: 1, title: 'Untitled', tokenCount: 0 },
      { textId: 'c', position: 2, title: 'Finale', tokenCount: 340 },
    ]);
  });
});

describe('grantCollectionShare', () => {
  it('404s when the collection is missing', async () => {
    queue.push([]);
    await expect(
      grantCollectionShare({
        collectionId: 'missing',
        actor: OWNER,
        recipientUserId: 'u-recipient',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner', async () => {
    queue.push([baseCollection]);
    await expect(
      grantCollectionShare({
        collectionId: 'col-1',
        actor: STRANGER,
        recipientUserId: 'u-recipient',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects sharing with the owner themselves', async () => {
    queue.push([baseCollection]);
    await expect(
      grantCollectionShare({
        collectionId: 'col-1',
        actor: OWNER,
        recipientUserId: OWNER.id,
      }),
    ).rejects.toThrow(/cannot share .* with its owner/);
  });

  it('404s when the recipient user does not exist', async () => {
    queue.push([baseCollection]);
    queue.push([]); // recipient lookup empty
    await expect(
      grantCollectionShare({
        collectionId: 'col-1',
        actor: OWNER,
        recipientUserId: 'u-ghost',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('inserts the share and promotes private → shared', async () => {
    queue.push([baseCollection]); // loadCollection (visibility: private)
    queue.push([{ id: 'u-recipient' }]); // recipient lookup
    queue.push([
      {
        collectionId: 'col-1',
        sharedWithUserId: 'u-recipient',
        grantedById: OWNER.id,
        createdAt: new Date(),
      },
    ]); // returning
    queue.push([]); // visibility update (no-await result)
    const share = await grantCollectionShare({
      collectionId: 'col-1',
      actor: OWNER,
      recipientUserId: 'u-recipient',
    });
    expect(share.sharedWithUserId).toBe('u-recipient');
    // Two write paths: insert (share) + update (visibility promotion).
    expect(fakeDb.insert).toHaveBeenCalledOnce();
    expect(fakeDb.update).toHaveBeenCalledOnce();
    const setArg = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.visibility).toBe('shared');
  });

  it('skips the visibility update when already shared', async () => {
    queue.push([{ ...baseCollection, visibility: 'shared' }]);
    queue.push([{ id: 'u-recipient' }]);
    queue.push([
      {
        collectionId: 'col-1',
        sharedWithUserId: 'u-recipient',
        grantedById: OWNER.id,
        createdAt: new Date(),
      },
    ]);
    await grantCollectionShare({
      collectionId: 'col-1',
      actor: OWNER,
      recipientUserId: 'u-recipient',
    });
    expect(fakeDb.update).not.toHaveBeenCalled();
  });

  it('throws when the insert returns no row', async () => {
    queue.push([baseCollection]);
    queue.push([{ id: 'u-recipient' }]);
    queue.push([]); // insert returning empty
    await expect(
      grantCollectionShare({
        collectionId: 'col-1',
        actor: OWNER,
        recipientUserId: 'u-recipient',
      }),
    ).rejects.toThrow(/insert returned no row/);
  });

  it('lets an admin grant on behalf of an arbitrary owner', async () => {
    queue.push([baseCollection]);
    queue.push([{ id: 'u-recipient' }]);
    queue.push([
      {
        collectionId: 'col-1',
        sharedWithUserId: 'u-recipient',
        grantedById: ADMIN.id,
        createdAt: new Date(),
      },
    ]);
    queue.push([]);
    const share = await grantCollectionShare({
      collectionId: 'col-1',
      actor: ADMIN,
      recipientUserId: 'u-recipient',
    });
    expect(share.grantedById).toBe(ADMIN.id);
  });
});

describe('revokeCollectionShare', () => {
  it('404s when the collection is missing', async () => {
    queue.push([]);
    await expect(
      revokeCollectionShare({
        collectionId: 'missing',
        actor: OWNER,
        recipientUserId: 'u-recipient',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner', async () => {
    queue.push([baseCollection]);
    await expect(
      revokeCollectionShare({
        collectionId: 'col-1',
        actor: STRANGER,
        recipientUserId: 'u-recipient',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('issues a delete for the owner', async () => {
    queue.push([baseCollection]);
    queue.push([]); // delete().where() resolution
    await revokeCollectionShare({
      collectionId: 'col-1',
      actor: OWNER,
      recipientUserId: 'u-recipient',
    });
    expect(fakeDb.delete).toHaveBeenCalledOnce();
  });
});

describe('listCollectionShares', () => {
  it('404s when the collection is missing', async () => {
    queue.push([]);
    await expect(
      listCollectionShares('missing', OWNER),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner', async () => {
    queue.push([baseCollection]);
    await expect(
      listCollectionShares('col-1', STRANGER),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('returns the share rows for the owner', async () => {
    queue.push([baseCollection]);
    queue.push([
      {
        collectionId: 'col-1',
        sharedWithUserId: 'u2',
        grantedById: OWNER.id,
        createdAt: new Date(),
      },
      {
        collectionId: 'col-1',
        sharedWithUserId: 'u3',
        grantedById: OWNER.id,
        createdAt: new Date(),
      },
    ]);
    const out = await listCollectionShares('col-1', OWNER);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.sharedWithUserId)).toEqual(['u2', 'u3']);
  });
});

describe('viewerHasCollectionShareForText', () => {
  it('returns true when a join row matches', async () => {
    queue.push([{ collectionId: 'col-1' }]);
    expect(await viewerHasCollectionShareForText('viewer', 't1')).toBe(true);
  });

  it('returns false when no row matches', async () => {
    queue.push([]);
    expect(await viewerHasCollectionShareForText('viewer', 't-orphan')).toBe(false);
  });
});

describe('viewerHasCollectionShare (T-8.4)', () => {
  it('returns true when the viewer has a share row for the collection', async () => {
    const { viewerHasCollectionShare } = await import('./collections.js');
    queue.push([{ collectionId: 'col-1' }]);
    expect(await viewerHasCollectionShare('viewer-1', 'col-1')).toBe(true);
  });

  it('returns false when no share row exists', async () => {
    const { viewerHasCollectionShare } = await import('./collections.js');
    queue.push([]);
    expect(await viewerHasCollectionShare('viewer-2', 'col-1')).toBe(false);
  });
});
