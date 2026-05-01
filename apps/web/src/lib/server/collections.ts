/**
 * Collections service (T-8.1 / T-8.2 / T-8.3 / T-8.5).
 *
 * Models a collection as an ordered group of texts that share a
 * language. Owner-or-admin manages membership; readers list their
 * own collections + the official catalog.
 *
 * Pure DB-side service — UI lives in routes/collections, /library,
 * and the reader's prev/next-text strip (T-8.3).
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import type {
  Collection,
  CollectionItem,
  CollectionShare,
  Text,
  User,
} from './db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

export class CollectionError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'CollectionError';
  }
}

export type CreateCollectionInput = {
  ownerId: string;
  language: LanguageCode;
  kind?: Collection['kind'];
  title: string;
  description?: string | null;
  coverUrl?: string | null;
};

export async function createCollection(
  input: CreateCollectionInput,
): Promise<Collection> {
  const title = input.title.trim();
  if (!title) throw new CollectionError('title required');
  const [row] = await db
    .insert(schema.collections)
    .values({
      ownerId: input.ownerId,
      language: input.language,
      kind: input.kind ?? 'chapter_book',
      title,
      description: input.description?.trim() || null,
      coverUrl: input.coverUrl?.trim() || null,
    })
    .returning();
  if (!row) throw new CollectionError('insert returned no row');
  return row as Collection;
}

async function loadCollection(id: string): Promise<Collection | null> {
  const [row] = (await db
    .select()
    .from(schema.collections)
    .where(eq(schema.collections.id, id))
    .limit(1)) as Collection[];
  return row ?? null;
}

function canManage(
  c: Collection,
  actor: Pick<User, 'id' | 'role'>,
): boolean {
  return actor.role === 'admin' || c.ownerId === actor.id;
}

export type UpdateCollectionInput = {
  collectionId: string;
  actor: Pick<User, 'id' | 'role'>;
  patch: Partial<{
    title: string;
    description: string | null;
    coverUrl: string | null;
    kind: Collection['kind'];
    visibility: Collection['visibility'];
  }>;
};

export async function updateCollection(
  input: UpdateCollectionInput,
): Promise<Collection> {
  const c = await loadCollection(input.collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, input.actor)) {
    throw new CollectionError('only the owner can update', 403);
  }
  // Promotion to official is admin-only; mirrors text-visibility
  // policy (T-7.1).
  if (
    input.patch.visibility === 'official' &&
    input.actor.role !== 'admin'
  ) {
    throw new CollectionError(
      'only admins can mark a collection official',
      403,
    );
  }
  if (c.visibility === 'official' && input.actor.role !== 'admin') {
    throw new CollectionError(
      'only admins can change visibility on an official collection',
      403,
    );
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.patch.title !== undefined) set.title = input.patch.title.trim();
  if (input.patch.description !== undefined)
    set.description = input.patch.description?.trim() || null;
  if (input.patch.coverUrl !== undefined)
    set.coverUrl = input.patch.coverUrl?.trim() || null;
  if (input.patch.kind !== undefined) set.kind = input.patch.kind;
  if (input.patch.visibility !== undefined)
    set.visibility = input.patch.visibility;

  const [updated] = await db
    .update(schema.collections)
    .set(set)
    .where(eq(schema.collections.id, input.collectionId))
    .returning();
  if (!updated) throw new CollectionError('update returned no row');
  return updated as Collection;
}

export type CollectionActor = {
  collectionId: string;
  actor: Pick<User, 'id' | 'role'>;
};

export async function deleteCollection(input: CollectionActor): Promise<void> {
  const c = await loadCollection(input.collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, input.actor)) {
    throw new CollectionError('only the owner can delete', 403);
  }
  await db
    .delete(schema.collections)
    .where(eq(schema.collections.id, input.collectionId));
}

export type AddItemInput = CollectionActor & {
  textId: string;
  /** Position to insert at; defaults to the end. */
  position?: number;
};

/**
 * Add a text to a collection. The text's language must match the
 * collection's; we check that explicitly so a curator can't end up
 * with a Hindi novel containing a Marathi chapter.
 */
export async function addCollectionItem(
  input: AddItemInput,
): Promise<CollectionItem> {
  const c = await loadCollection(input.collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, input.actor)) {
    throw new CollectionError('only the owner can add items', 403);
  }
  const [text] = (await db
    .select({ id: schema.texts.id, language: schema.texts.language })
    .from(schema.texts)
    .where(eq(schema.texts.id, input.textId))
    .limit(1)) as Array<{ id: string; language: string }>;
  if (!text) throw new CollectionError('text not found', 404);
  if (text.language !== c.language) {
    throw new CollectionError(
      `text language (${text.language}) does not match collection (${c.language})`,
    );
  }

  let position = input.position;
  if (position === undefined) {
    const [{ max } = { max: -1 }] = (await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)::int` })
      .from(schema.collectionItems)
      .where(eq(schema.collectionItems.collectionId, input.collectionId))) as Array<{
      max: number;
    }>;
    position = (max ?? -1) + 1;
  }

  const [row] = await db
    .insert(schema.collectionItems)
    .values({
      collectionId: input.collectionId,
      textId: input.textId,
      position,
    })
    .onConflictDoUpdate({
      target: [
        schema.collectionItems.collectionId,
        schema.collectionItems.textId,
      ],
      set: { position },
    })
    .returning();
  if (!row) throw new CollectionError('insert returned no row');
  return row as CollectionItem;
}

export type RemoveItemInput = CollectionActor & { textId: string };

export async function removeCollectionItem(
  input: RemoveItemInput,
): Promise<void> {
  const c = await loadCollection(input.collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, input.actor)) {
    throw new CollectionError('only the owner can remove items', 403);
  }
  await db
    .delete(schema.collectionItems)
    .where(
      and(
        eq(schema.collectionItems.collectionId, input.collectionId),
        eq(schema.collectionItems.textId, input.textId),
      ),
    );
}

export type ReorderInput = CollectionActor & {
  /** Ordered list of textIds in the collection's intended new order.
   *  Must match the collection's existing items exactly (no missing,
   *  no extra) — the service rejects partial reorders so a buggy
   *  client can't silently lose a member. */
  textIds: string[];
};

export async function reorderCollection(
  input: ReorderInput,
): Promise<CollectionItem[]> {
  const c = await loadCollection(input.collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, input.actor)) {
    throw new CollectionError('only the owner can reorder', 403);
  }
  const existing = (await db
    .select()
    .from(schema.collectionItems)
    .where(eq(schema.collectionItems.collectionId, input.collectionId))) as CollectionItem[];
  const existingIds = new Set(existing.map((r) => r.textId));
  const submitted = new Set(input.textIds);
  if (existingIds.size !== submitted.size) {
    throw new CollectionError(
      `reorder must include every member (got ${submitted.size}, have ${existingIds.size})`,
    );
  }
  for (const id of existingIds) {
    if (!submitted.has(id)) {
      throw new CollectionError(`reorder missing text ${id}`);
    }
  }

  // Rewrite positions in one batch. Drizzle doesn't expose
  // multi-row UPDATE in a single SQL statement nicely; we issue N
  // updates wrapped in a transaction.
  await db.transaction(async (tx) => {
    let i = 0;
    for (const textId of input.textIds) {
      await tx
        .update(schema.collectionItems)
        .set({ position: i })
        .where(
          and(
            eq(schema.collectionItems.collectionId, input.collectionId),
            eq(schema.collectionItems.textId, textId),
          ),
        );
      i += 1;
    }
  });

  return (await db
    .select()
    .from(schema.collectionItems)
    .where(eq(schema.collectionItems.collectionId, input.collectionId))
    .orderBy(asc(schema.collectionItems.position))) as CollectionItem[];
}

export type CollectionListItem = {
  collection: Collection;
  textCount: number;
};

export async function listCollectionsForUser(
  userId: string,
): Promise<CollectionListItem[]> {
  const rows = (await db
    .select({
      collection: schema.collections,
      textCount: sql<number>`COUNT(${schema.collectionItems.textId})::int`,
    })
    .from(schema.collections)
    .leftJoin(
      schema.collectionItems,
      eq(schema.collectionItems.collectionId, schema.collections.id),
    )
    .where(eq(schema.collections.ownerId, userId))
    .groupBy(schema.collections.id)
    .orderBy(desc(schema.collections.updatedAt))) as Array<{
    collection: Collection;
    textCount: number;
  }>;
  return rows;
}

export async function listOfficialCollections(
  language?: LanguageCode,
): Promise<CollectionListItem[]> {
  const conditions = [eq(schema.collections.visibility, 'official')];
  if (language) conditions.push(eq(schema.collections.language, language));
  const rows = (await db
    .select({
      collection: schema.collections,
      textCount: sql<number>`COUNT(${schema.collectionItems.textId})::int`,
    })
    .from(schema.collections)
    .leftJoin(
      schema.collectionItems,
      eq(schema.collectionItems.collectionId, schema.collections.id),
    )
    .where(and(...conditions))
    .groupBy(schema.collections.id)
    .orderBy(desc(schema.collections.updatedAt))) as Array<{
    collection: Collection;
    textCount: number;
  }>;
  return rows;
}

export type CollectionDetail = {
  collection: Collection;
  items: Array<{
    position: number;
    text: Text;
  }>;
};

export async function loadCollectionDetail(
  collectionId: string,
): Promise<CollectionDetail | null> {
  const c = await loadCollection(collectionId);
  if (!c) return null;
  const rows = (await db
    .select({
      position: schema.collectionItems.position,
      text: schema.texts,
    })
    .from(schema.collectionItems)
    .innerJoin(
      schema.texts,
      eq(schema.texts.id, schema.collectionItems.textId),
    )
    .where(eq(schema.collectionItems.collectionId, collectionId))
    .orderBy(asc(schema.collectionItems.position))) as Array<{
    position: number;
    text: Text;
  }>;
  return { collection: c, items: rows };
}

// ---------------------------------------------------------------
// Collection shares (T-8.4)
// ---------------------------------------------------------------

export type CollectionShareInput = {
  collectionId: string;
  recipientUserId: string;
  actor: Pick<User, 'id' | 'role'>;
};

export async function grantCollectionShare(
  input: CollectionShareInput,
): Promise<CollectionShare> {
  const c = await loadCollection(input.collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, input.actor)) {
    throw new CollectionError('only the owner can share', 403);
  }
  if (c.ownerId === input.recipientUserId) {
    throw new CollectionError('cannot share a collection with its owner');
  }
  const [recipient] = (await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, input.recipientUserId))
    .limit(1)) as Array<{ id: string }>;
  if (!recipient) throw new CollectionError('recipient not found', 404);

  const now = new Date();
  const [row] = await db
    .insert(schema.collectionShares)
    .values({
      collectionId: input.collectionId,
      sharedWithUserId: input.recipientUserId,
      grantedById: input.actor.id,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.collectionShares.collectionId,
        schema.collectionShares.sharedWithUserId,
      ],
      set: { grantedById: input.actor.id },
    })
    .returning();
  if (!row) throw new CollectionError('insert returned no row');

  // Promote private → shared so canReadText accepts the recipient.
  if (c.visibility === 'private') {
    await db
      .update(schema.collections)
      .set({ visibility: 'shared', updatedAt: now })
      .where(eq(schema.collections.id, input.collectionId));
  }
  return row as CollectionShare;
}

export async function revokeCollectionShare(
  input: CollectionShareInput,
): Promise<void> {
  const c = await loadCollection(input.collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, input.actor)) {
    throw new CollectionError('only the owner can revoke', 403);
  }
  await db
    .delete(schema.collectionShares)
    .where(
      and(
        eq(schema.collectionShares.collectionId, input.collectionId),
        eq(schema.collectionShares.sharedWithUserId, input.recipientUserId),
      ),
    );
}

export async function listCollectionShares(
  collectionId: string,
  actor: Pick<User, 'id' | 'role'>,
): Promise<CollectionShare[]> {
  const c = await loadCollection(collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, actor)) {
    throw new CollectionError('only the owner can list shares', 403);
  }
  return (await db
    .select()
    .from(schema.collectionShares)
    .where(
      eq(schema.collectionShares.collectionId, collectionId),
    )) as CollectionShare[];
}

/**
 * T-8.4 — share row decorated with the recipient's email + display
 * name. The bare `CollectionShare` only carries `sharedWithUserId`
 * which isn't human-readable; the manage-shares UI (and the GET
 * /shares JSON endpoint) call this so the owner sees who actually
 * has access. Recipients that have since been deleted come through
 * with `recipient: null`.
 */
export type CollectionShareWithRecipient = CollectionShare & {
  recipient: {
    id: string;
    email: string;
    displayName: string | null;
  } | null;
};

export async function listCollectionSharesWithRecipients(
  collectionId: string,
  actor: Pick<User, 'id' | 'role'>,
): Promise<CollectionShareWithRecipient[]> {
  const shares = await listCollectionShares(collectionId, actor);
  if (shares.length === 0) return [];
  const ids = shares.map((s) => s.sharedWithUserId);
  const recipients = (await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, ids))) as Array<{
    id: string;
    email: string;
    displayName: string | null;
  }>;
  const byId = new Map(recipients.map((r) => [r.id, r]));
  return shares.map((s) => ({
    ...s,
    recipient: byId.get(s.sharedWithUserId) ?? null,
  }));
}

/**
 * T-8.4 — does this viewer have a share row for this collection?
 * Used by the collection detail page (`/collections/:id`) to grant
 * non-owners view access. Cheap lookup against the
 * `(collectionId, sharedWithUserId)` unique index.
 */
export async function viewerHasCollectionShare(
  viewerId: string,
  collectionId: string,
): Promise<boolean> {
  const [row] = (await db
    .select({ collectionId: schema.collectionShares.collectionId })
    .from(schema.collectionShares)
    .where(
      and(
        eq(schema.collectionShares.collectionId, collectionId),
        eq(schema.collectionShares.sharedWithUserId, viewerId),
      ),
    )
    .limit(1)) as Array<{ collectionId: string }>;
  return Boolean(row);
}

/**
 * Used by canReadText: does the viewer have access to `textId` via
 * a collection share? The text is shared if it's a member of any
 * collection the viewer has been granted access to.
 */
export async function viewerHasCollectionShareForText(
  viewerId: string,
  textId: string,
): Promise<boolean> {
  const [row] = (await db
    .select({ collectionId: schema.collectionShares.collectionId })
    .from(schema.collectionShares)
    .innerJoin(
      schema.collectionItems,
      eq(
        schema.collectionItems.collectionId,
        schema.collectionShares.collectionId,
      ),
    )
    .where(
      and(
        eq(schema.collectionShares.sharedWithUserId, viewerId),
        eq(schema.collectionItems.textId, textId),
      ),
    )
    .limit(1)) as Array<{ collectionId: string }>;
  return Boolean(row);
}

// ---------------------------------------------------------------

/**
 * For T-8.3: when the reader is on a text that belongs to a
 * collection the viewer can see, surface the collection title +
 * prev / next text ids. Picks the FIRST collection the text
 * belongs to (deterministic order: collections.updatedAt DESC) so
 * a text that's a member of multiple collections still gives a
 * predictable nav strip.
 */
export type ReaderCollectionContext = {
  collection: Collection;
  position: number;
  prevTextId: string | null;
  nextTextId: string | null;
  totalCount: number;
};

export async function readerCollectionContext(
  textId: string,
): Promise<ReaderCollectionContext | null> {
  const [hit] = (await db
    .select({
      collection: schema.collections,
      position: schema.collectionItems.position,
    })
    .from(schema.collectionItems)
    .innerJoin(
      schema.collections,
      eq(schema.collections.id, schema.collectionItems.collectionId),
    )
    .where(eq(schema.collectionItems.textId, textId))
    .orderBy(desc(schema.collections.updatedAt))
    .limit(1)) as Array<{ collection: Collection; position: number }>;
  if (!hit) return null;

  const siblings = (await db
    .select({
      textId: schema.collectionItems.textId,
      position: schema.collectionItems.position,
    })
    .from(schema.collectionItems)
    .where(eq(schema.collectionItems.collectionId, hit.collection.id))
    .orderBy(asc(schema.collectionItems.position))) as Array<{
    textId: string;
    position: number;
  }>;
  const totalCount = siblings.length;
  const idx = siblings.findIndex((s) => s.position === hit.position);
  return {
    collection: hit.collection,
    position: hit.position,
    prevTextId: idx > 0 ? (siblings[idx - 1]?.textId ?? null) : null,
    nextTextId:
      idx >= 0 && idx < siblings.length - 1
        ? (siblings[idx + 1]?.textId ?? null)
        : null,
    totalCount,
  };
}
