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
  TextChapter,
  User,
} from './db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';
import { enqueueNlpJob } from './texts/jobs.js';
import { prependTitleToBody, type ChapterDraft } from './texts/chunking.js';

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

export type CreateChapterBookInput = {
  ownerId: string;
  language: LanguageCode;
  title: string;
  /** `'epub'` or `'zip'` — surfaced on each child `texts` row so the
   *  library / admin views can tell where a chapter book came from. */
  sourceType: 'epub' | 'zip';
  /** Per-chapter drafts in display order. `idx` on each draft is the
   *  position within the collection (0-based, contiguous). Each draft
   *  becomes its own `texts` row plus a single-chapter
   *  `text_chapters` row, then a `collection_items` row linking the
   *  text to the new collection at `position = draft.idx`.
   *
   *  Optional `section` is the parent-heading from the publisher's
   *  TOC (EPUB nav doc) — when present we persist it on
   *  `collection_items.section_title` so the detail page can group
   *  chapters under their Part heading. ZIP uploads and flat EPUBs
   *  leave it null. */
  chapters: Array<ChapterDraft & { section?: string | null }>;
  now?: Date;
};

export type ChapterBookCreated = {
  collection: Collection;
  texts: Text[];
  items: CollectionItem[];
};

/**
 * Create a chapter-book collection from EPUB / ZIP-style chapter
 * drafts in one transaction. Each draft becomes:
 *
 *   1. A `texts` row (single-chapter doc, `status='pending'`,
 *      `visibility='private'`). The chapter title is the draft's
 *      title, falling back to `Chapter N` when the source didn't
 *      provide one.
 *   2. A `text_chapters` row at `idx=0` holding the body.
 *   3. A `collection_items` row at `position = draft.idx` linking the
 *      text to the new collection.
 *
 * After the transaction commits, an NLP job is enqueued per child
 * text — same shape the paste / .txt path uses, so every chapter gets
 * its own status / progress / known-word coverage rather than being
 * lumped under the book-level row.
 *
 * Rolls back the whole thing if any insert (or the NLP enqueue)
 * throws — no orphan rows.
 */
export async function createChapterBookCollection(
  input: CreateChapterBookInput,
): Promise<ChapterBookCreated> {
  const title = input.title.trim();
  if (!title) throw new CollectionError('title required');
  if (input.chapters.length === 0) {
    throw new CollectionError('chapter book must have at least one chapter');
  }
  const now = input.now ?? new Date();

  // Deferred dispatcher calls collected during the transaction —
  // fired AFTER commit so the in-process worker sees rows the
  // global `db` connection can read. Firing inside the tx makes
  // `processTextNow`'s SELECT against `db` miss the not-yet-
  // committed text and leave the chapter stuck at 'pending'.
  const flushes: Array<() => Promise<void>> = [];

  const result = await db.transaction(async (tx) => {
    const [collection] = (await tx
      .insert(schema.collections)
      .values({
        ownerId: input.ownerId,
        language: input.language,
        kind: 'chapter_book',
        title,
        visibility: 'private',
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as Collection[];
    if (!collection) throw new CollectionError('collection insert returned no row');

    const createdTexts: Text[] = [];
    const createdItems: CollectionItem[] = [];

    for (const draft of input.chapters) {
      // "Untitled" rather than "Chapter N" because the chapter card
      // and reader nav already surface the position number — a
      // separate "Chapter N" prefix would just duplicate that. The
      // fallback fires for EPUBs whose nav doc + chapter <title> are
      // both junk auto-IDs (see `isJunkTitle` in epub.ts).
      const chapterTitle = draft.title?.trim() || 'Untitled';
      const [text] = (await tx
        .insert(schema.texts)
        .values({
          ownerId: input.ownerId,
          language: input.language,
          title: chapterTitle,
          sourceType: input.sourceType,
          status: 'pending',
          visibility: 'private',
          createdAt: now,
          updatedAt: now,
        })
        .returning()) as Text[];
      if (!text) throw new CollectionError('text insert returned no row');

      // Prepend the chapter title to the body so the NLP pipeline
      // tokenizes the title alongside the rest of the content (its
      // words become clickable + known-word-tracked). The helper is
      // idempotent: an EPUB whose `htmlToText` output already starts
      // with the title — e.g. `<h1>Chapter One</h1>` in the body
      // matching the nav title — doesn't get a duplicated heading.
      const { body: bodyWithTitle, tokenCount: tokenCountWithTitle } =
        prependTitleToBody(chapterTitle, draft.body);
      const [chapterRow] = (await tx
        .insert(schema.textChapters)
        .values({
          textId: text.id,
          idx: 0,
          title: chapterTitle,
          body: bodyWithTitle,
          tokenCount: tokenCountWithTitle,
          createdAt: now,
        })
        .returning()) as TextChapter[];
      if (!chapterRow) {
        throw new CollectionError('chapter insert returned no row');
      }

      const [item] = (await tx
        .insert(schema.collectionItems)
        .values({
          collectionId: collection.id,
          textId: text.id,
          position: draft.idx,
          sectionTitle: draft.section ?? null,
          createdAt: now,
        })
        .returning()) as CollectionItem[];
      if (!item) throw new CollectionError('item insert returned no row');

      // Insert the nlp_jobs row inside the tx (FK needs the text);
      // defer the dispatcher until after commit.
      const enqueued = await enqueueNlpJob({
        textId: text.id,
        chapterIds: [chapterRow.id],
        now,
        tx,
      });
      if (enqueued.flush) flushes.push(enqueued.flush);

      createdTexts.push(text);
      createdItems.push(item);
    }

    return {
      collection,
      texts: createdTexts,
      items: createdItems,
    };
  });

  // Transaction committed — now safe to wake the worker for every
  // chapter text. We fire sequentially so a thrown dispatcher (e.g.
  // unreachable NLP service) surfaces predictably; the in-process
  // dispatcher is fire-and-forget per text so this is cheap.
  for (const flush of flushes) {
    await flush();
  }

  return result;
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

/**
 * Delete a collection. For `chapter_book` collections, also cascades
 * to the member texts — those rows only exist as chapters of the
 * book, so a "delete book" gesture should clean them up too.
 *
 * For `course` and `anthology` kinds the member texts are
 * independent (curators just group them), so we leave the texts
 * alone and only break the collection-item links.
 *
 * Wrapped in a transaction so a chapter_book delete is all-or-
 * nothing: either every chapter goes with the book, or none do.
 */
export async function deleteCollection(input: CollectionActor): Promise<void> {
  const c = await loadCollection(input.collectionId);
  if (!c) throw new CollectionError('collection not found', 404);
  if (!canManage(c, input.actor)) {
    throw new CollectionError('only the owner can delete', 403);
  }

  if (c.kind === 'chapter_book') {
    // Snapshot member ids before we drop the collection, since the
    // `collection_items` rows cascade away with the parent.
    const items = (await db
      .select({ textId: schema.collectionItems.textId })
      .from(schema.collectionItems)
      .where(eq(schema.collectionItems.collectionId, c.id))) as Array<{
      textId: string;
    }>;
    const textIds = items.map((r) => r.textId);
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.collections)
        .where(eq(schema.collections.id, c.id));
      if (textIds.length > 0) {
        await tx
          .delete(schema.texts)
          .where(inArray(schema.texts.id, textIds));
      }
    });
    return;
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
  /** The chapter-text to open when the book is tapped: the one read most
   *  recently, else the first chapter. Null only for an empty book. */
  openTextId?: string | null;
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

  // Most-recently-read chapter-text per collection, so opening a book resumes.
  const progress = (await db
    .select({
      collectionId: schema.collectionItems.collectionId,
      textId: schema.collectionItems.textId,
      updatedAt: schema.userTextProgress.updatedAt,
    })
    .from(schema.userTextProgress)
    .innerJoin(
      schema.collectionItems,
      eq(schema.collectionItems.textId, schema.userTextProgress.textId),
    )
    .where(eq(schema.userTextProgress.userId, userId))) as Array<{
    collectionId: string;
    textId: string;
    updatedAt: Date;
  }>;
  const lastRead = new Map<string, { textId: string; updatedAt: Date }>();
  for (const p of progress) {
    const cur = lastRead.get(p.collectionId);
    if (!cur || p.updatedAt > cur.updatedAt) {
      lastRead.set(p.collectionId, { textId: p.textId, updatedAt: p.updatedAt });
    }
  }

  // First chapter per collection — the fallback for a book not yet started.
  const items = (await db
    .select({
      collectionId: schema.collectionItems.collectionId,
      textId: schema.collectionItems.textId,
    })
    .from(schema.collectionItems)
    .innerJoin(
      schema.collections,
      eq(schema.collections.id, schema.collectionItems.collectionId),
    )
    .where(eq(schema.collections.ownerId, userId))
    .orderBy(asc(schema.collectionItems.position))) as Array<{
    collectionId: string;
    textId: string;
  }>;
  const firstText = new Map<string, string>();
  for (const it of items) {
    if (!firstText.has(it.collectionId)) firstText.set(it.collectionId, it.textId);
  }

  return rows.map((r) => ({
    ...r,
    openTextId: lastRead.get(r.collection.id)?.textId ?? firstText.get(r.collection.id) ?? null,
  }));
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
    /** Parent-section title from the source TOC (Part heading, etc.).
     *  `null` for flat collections + manually-curated ones. */
    sectionTitle: string | null;
    text: Text;
    /** Total tokens across the chapter-text's chapters (for word counts /
     *  book-progress weighting). */
    wordCount: number;
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
      sectionTitle: schema.collectionItems.sectionTitle,
      text: schema.texts,
      wordCount: sql<number>`COALESCE((SELECT SUM(${schema.textChapters.tokenCount}) FROM ${schema.textChapters} WHERE ${schema.textChapters.textId} = ${schema.texts.id}), 0)::int`,
    })
    .from(schema.collectionItems)
    .innerJoin(
      schema.texts,
      eq(schema.texts.id, schema.collectionItems.textId),
    )
    .where(eq(schema.collectionItems.collectionId, collectionId))
    .orderBy(asc(schema.collectionItems.position))) as Array<{
    position: number;
    sectionTitle: string | null;
    text: Text;
    wordCount: number;
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
/** One chapter (member text) of a collection, shaped for the reader's
 *  chapter-selector TOC + whole-book progress. Each member of a
 *  chapter-book is a single-chapter `texts` row, so `tokenCount` is the
 *  sum of that text's chapter token counts (one chapter in practice). */
export type ReaderCollectionChapter = {
  textId: string;
  position: number;
  title: string;
  tokenCount: number;
};

export type ReaderCollectionContext = {
  collection: Collection;
  position: number;
  prevTextId: string | null;
  nextTextId: string | null;
  totalCount: number;
  /** Every sibling in display order — drives the reader's chapter TOC
   *  dropdown and the whole-book progress math. Cheap to ship inline:
   *  one small row per chapter (id + title + count). */
  chapters: ReaderCollectionChapter[];
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

  // Pull every sibling with its title + summed token count in one
  // grouped query — same COUNT/groupBy idiom as listCollectionsForUser.
  // leftJoin on text_chapters so a member whose chapter rows haven't
  // landed yet still appears (tokenCount 0) rather than dropping out.
  const siblings = (await db
    .select({
      textId: schema.collectionItems.textId,
      position: schema.collectionItems.position,
      title: schema.texts.title,
      tokenCount: sql<number>`COALESCE(SUM(${schema.textChapters.tokenCount}), 0)::int`,
    })
    .from(schema.collectionItems)
    .innerJoin(
      schema.texts,
      eq(schema.texts.id, schema.collectionItems.textId),
    )
    .leftJoin(
      schema.textChapters,
      eq(schema.textChapters.textId, schema.collectionItems.textId),
    )
    .where(eq(schema.collectionItems.collectionId, hit.collection.id))
    .groupBy(
      schema.collectionItems.textId,
      schema.collectionItems.position,
      schema.texts.title,
    )
    .orderBy(asc(schema.collectionItems.position))) as Array<{
    textId: string;
    position: number;
    title: string | null;
    tokenCount: number;
  }>;
  const chapters: ReaderCollectionChapter[] = siblings.map((s) => ({
    textId: s.textId,
    position: s.position,
    // Empty / whitespace titles fall back to 'Untitled', matching the
    // chapter-book creation default.
    title: s.title?.trim() || 'Untitled',
    tokenCount: Math.max(0, s.tokenCount ?? 0),
  }));
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
    chapters,
  };
}
