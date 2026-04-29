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
    texts: { id: 't.id', language: 't.language' },
    users: { id: 'u.id' },
  },
}));

const {
  CollectionError,
  createCollection,
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
} = await import('./collections.js');

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

  it('issues a delete for the owner', async () => {
    queue.push([baseCollection]); // loadCollection
    queue.push([]); // delete().where() resolution
    await deleteCollection({ collectionId: 'col-1', actor: OWNER });
    expect(fakeDb.delete).toHaveBeenCalledOnce();
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
      { textId: 'a', position: 0 },
      { textId: 'b', position: 1 },
      { textId: 'c', position: 2 },
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
      { textId: 'a', position: 0 },
      { textId: 'b', position: 1 },
    ]);
    const first = await readerCollectionContext('a');
    expect(first?.prevTextId).toBeNull();
    expect(first?.nextTextId).toBe('b');

    queue.push([{ collection: baseCollection, position: 1 }]); // last
    queue.push([
      { textId: 'a', position: 0 },
      { textId: 'b', position: 1 },
    ]);
    const last = await readerCollectionContext('b');
    expect(last?.prevTextId).toBe('a');
    expect(last?.nextTextId).toBeNull();
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
