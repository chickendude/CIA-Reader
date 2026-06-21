/**
 * Book-wide lemma frequency.
 *
 * "How many times does this word appear in the book" — where a *book* is the
 * `collection` the text belongs to (its sibling texts), falling back to the
 * single text when it isn't in a collection. Lets a reader prioritise the
 * words that recur most. Counts are over `text_tokens.lemma_id`, scoped to the
 * book's chapter ids (token → chapter → text → collection_items chain).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';

export type BookChapterScope = {
  /** Chapter ids across every text in the book (collection). */
  bookChapterIds: string[];
  /** Chapter ids of just the current text. */
  textChapterIds: string[];
};

/**
 * Resolve the chapter ids for the whole book containing `textId`, plus the
 * current text's own chapters. When the text isn't a member of any collection
 * the book scope is just the text itself.
 */
export async function resolveBookChapterScope(textId: string): Promise<BookChapterScope> {
  const ownChapters = await db
    .select({ id: schema.textChapters.id })
    .from(schema.textChapters)
    .where(eq(schema.textChapters.textId, textId));
  const textChapterIds = ownChapters.map((c) => c.id);

  const [item] = await db
    .select({ collectionId: schema.collectionItems.collectionId })
    .from(schema.collectionItems)
    .where(eq(schema.collectionItems.textId, textId))
    .limit(1);

  if (!item) {
    return { bookChapterIds: textChapterIds, textChapterIds };
  }

  const siblingTexts = await db
    .select({ textId: schema.collectionItems.textId })
    .from(schema.collectionItems)
    .where(eq(schema.collectionItems.collectionId, item.collectionId));
  const bookTextIds = siblingTexts.map((r) => r.textId);

  const bookChapters =
    bookTextIds.length > 0
      ? await db
          .select({ id: schema.textChapters.id })
          .from(schema.textChapters)
          .where(inArray(schema.textChapters.textId, bookTextIds))
      : [];

  return { bookChapterIds: bookChapters.map((c) => c.id), textChapterIds };
}

async function countLemmaInChapters(chapterIds: string[], lemmaId: string): Promise<number> {
  if (chapterIds.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.textTokens)
    .where(
      and(
        inArray(schema.textTokens.chapterId, chapterIds),
        eq(schema.textTokens.lemmaId, lemmaId),
      ),
    );
  return row?.n ?? 0;
}

/** Occurrences of `lemmaId` across the whole book and within the current text. */
export async function lemmaBookFrequency(
  textId: string,
  lemmaId: string,
): Promise<{ book: number; text: number }> {
  const { bookChapterIds, textChapterIds } = await resolveBookChapterScope(textId);
  const [book, text] = await Promise.all([
    countLemmaInChapters(bookChapterIds, lemmaId),
    countLemmaInChapters(textChapterIds, lemmaId),
  ]);
  return { book, text };
}

/**
 * Batch book-wide counts for many lemmas at once (one grouped query) — used by
 * the words / Anki-export list to sort by frequency.
 */
export async function lemmaBookFrequencies(
  textId: string,
  lemmaIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (lemmaIds.length === 0) return counts;
  const { bookChapterIds } = await resolveBookChapterScope(textId);
  if (bookChapterIds.length === 0) return counts;

  const rows = await db
    .select({ lemmaId: schema.textTokens.lemmaId, n: sql<number>`count(*)::int` })
    .from(schema.textTokens)
    .where(
      and(
        inArray(schema.textTokens.chapterId, bookChapterIds),
        inArray(schema.textTokens.lemmaId, lemmaIds),
      ),
    )
    .groupBy(schema.textTokens.lemmaId);

  for (const r of rows) {
    if (r.lemmaId) counts.set(r.lemmaId, r.n);
  }
  return counts;
}
