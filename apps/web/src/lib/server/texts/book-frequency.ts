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
import type { LanguageCode } from '@ciareader/shared-types';

import { readerFrequencies } from './reader-frequencies';
import { canReadText } from '../auth/can-read.js';
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
export async function resolveBookChapterScope(textId: string, userId?: string): Promise<BookChapterScope> {
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
  let bookTextIds = siblingTexts.map((r) => r.textId);
  if (userId && bookTextIds.length) {
    // Exports include sample sentences, so check access to each collection member.
    const members = await db.select().from(schema.texts).where(inArray(schema.texts.id, bookTextIds));
    const readable = await Promise.all(members.map((member) => canReadText({ id: userId }, member)));
    bookTextIds = members.filter((_, index) => readable[index]).map((member) => member.id);
  }

  const bookChapters =
    bookTextIds.length > 0
      ? await db
          .select({ id: schema.textChapters.id })
          .from(schema.textChapters)
          .where(inArray(schema.textChapters.textId, bookTextIds))
      : [];

  return { bookChapterIds: bookChapters.map((c) => c.id), textChapterIds };
}

type HeadwordKey = { id?: string; headword: string; language: LanguageCode };

/**
 * Count occurrences of a *word* (by headword) — not a single lemma row — so the
 * tally rolls up every lemma row that shares the headword. The NLP and the
 * dictionary import both create several `lemmas` rows for one word (duplicate
 * (headword, pos) rows; a surface tagged NOUN in one place and ADJ in another),
 * and inflected surfaces all carry their citation headword. Counting by
 * `lemma_id` alone splits those apart and undercounts; counting by headword
 * matches what the reader sees as "the same word" (and mirrors the dictionary's
 * by-headword sibling lookup).
 */
async function countHeadwordInChapters(
  chapterIds: string[],
  lemma: HeadwordKey,
  userId?: string,
): Promise<number> {
  if (chapterIds.length === 0) return 0;
  if (lemma.language === 'hi' && lemma.id) {
    const [row] = await db.select({ n: sql<number>`coalesce(sum(${schema.chapterWordFrequencies.occurrences}),0)::int` })
      .from(userId ? sql`${readerFrequencies('chapter', userId)} AS chapter_word_frequencies` : schema.chapterWordFrequencies).where(and(
        inArray(schema.chapterWordFrequencies.chapterId, chapterIds),
        eq(schema.chapterWordFrequencies.lemmaId, lemma.id),
      ));
    return row?.n ?? 0;
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.textTokens)
    .innerJoin(schema.lemmas, eq(schema.textTokens.lemmaId, schema.lemmas.id))
    .where(
      and(
        inArray(schema.textTokens.chapterId, chapterIds),
        eq(schema.lemmas.language, lemma.language),
        eq(schema.lemmas.headword, lemma.headword),
        userId ? sql`NOT EXISTS (SELECT 1 FROM reader_ignored_tokens i WHERE i.user_id=${userId} AND i.token_id=${schema.textTokens.id})` : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** Occurrences of the lemma's *word* across the whole book and within the text. */
export async function lemmaBookFrequency(
  textId: string,
  lemmaId: string,
  userId?: string,
): Promise<{ book: number; text: number }> {
  const [lemma] = await db
    .select({ id: schema.lemmas.id, headword: schema.lemmas.headword, language: schema.lemmas.language })
    .from(schema.lemmas)
    .where(eq(schema.lemmas.id, lemmaId))
    .limit(1);
  if (!lemma) return { book: 0, text: 0 };
  const { bookChapterIds, textChapterIds } = await resolveBookChapterScope(textId);
  const [book, text] = await Promise.all([
    countHeadwordInChapters(bookChapterIds, lemma, userId),
    countHeadwordInChapters(textChapterIds, lemma, userId),
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
  userId?: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (lemmaIds.length === 0) return counts;
  const { bookChapterIds } = await resolveBookChapterScope(textId);
  if (bookChapterIds.length === 0) return counts;

  // Map the requested lemma ids → their headwords, then count by headword so
  // duplicate lemma rows for the same word roll up together (see
  // countHeadwordInChapters). Each requested id gets its word's total.
  const requested = await db
    .select({
      id: schema.lemmas.id,
      headword: schema.lemmas.headword,
      language: schema.lemmas.language,
    })
    .from(schema.lemmas)
    .where(inArray(schema.lemmas.id, lemmaIds));
  if (requested.length === 0) return counts;

  const byWord = requested.filter((lemma) => lemma.language !== 'hi');
  if (byWord.length) {
    const headwords = [...new Set(byWord.map((r) => r.headword))];
    const rows = await db
      .select({
        headword: schema.lemmas.headword,
        language: schema.lemmas.language,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.textTokens)
      .innerJoin(schema.lemmas, eq(schema.textTokens.lemmaId, schema.lemmas.id))
      .where(
        and(
          inArray(schema.textTokens.chapterId, bookChapterIds),
          inArray(schema.lemmas.headword, headwords),
          userId ? sql`NOT EXISTS (SELECT 1 FROM reader_ignored_tokens i WHERE i.user_id=${userId} AND i.token_id=${schema.textTokens.id})` : undefined,
        ),
      )
      .groupBy(schema.lemmas.headword, schema.lemmas.language);

    const byHeadword = new Map<string, number>();
    for (const r of rows) byHeadword.set(`${r.language}\0${r.headword}`, r.n);
    for (const r of byWord) {
      counts.set(r.id, byHeadword.get(`${r.language}\0${r.headword}`) ?? 0);
    }
  }
  const hindiIds = requested.filter((r) => r.language === 'hi').map((r) => r.id);
  if (hindiIds.length) {
    const hindiRows = await db.select({ id: sql<string>`${schema.chapterWordFrequencies.lemmaId}`, n: sql<number>`sum(${schema.chapterWordFrequencies.occurrences})::int` })
      .from(userId ? sql`${readerFrequencies('chapter', userId)} AS chapter_word_frequencies` : schema.chapterWordFrequencies).where(and(
        inArray(schema.chapterWordFrequencies.chapterId, bookChapterIds),
        inArray(schema.chapterWordFrequencies.lemmaId, hindiIds),
      )).groupBy(schema.chapterWordFrequencies.lemmaId);
    for (const id of hindiIds) counts.set(id, 0);
    for (const row of hindiRows) {
      if (row.id !== null) counts.set(row.id, row.n);
    }
  }
  return counts;
}
