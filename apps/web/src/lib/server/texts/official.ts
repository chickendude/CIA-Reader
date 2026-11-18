import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { isStaffMember } from '../auth/staff.js';
import type { AnkiCard } from '../anki.js';

export class OfficialBookError extends Error {
  constructor(message: string, public status: 400 | 403 | 404) { super(message); }
}

/** Public metadata only. Source bodies and occurrence contexts never leave this service. */
export async function getOfficialBook(textId: string, userId?: string) {
  const [text] = await db.select({ id: schema.texts.id, title: schema.texts.title, ownerId: schema.texts.ownerId,
    language: schema.texts.language, staffOnly: schema.texts.staffOnly, status: schema.texts.status })
    .from(schema.texts).where(and(eq(schema.texts.id, textId), eq(schema.texts.visibility, 'official'))).limit(1);
  if (!text) return null;
  const [counts] = await db.execute(sql`
    SELECT count(*)::int AS occurrences,
      count(DISTINCT o.lemma_id)::int AS unique_words,
      count(*) FILTER (WHERE o.lemma_id IS NULL)::int AS unresolved,
      count(*) FILTER (WHERE k.status='known')::int AS known,
      count(*) FILTER (WHERE k.status IN ('known','learning'))::int AS learning
    FROM vocabulary_occurrences o JOIN text_chapters ch ON ch.id=o.chapter_id
    LEFT JOIN user_known_lemmas k ON k.lemma_id=o.lemma_id AND k.user_id=${userId ?? null}::uuid
    WHERE ch.text_id=${textId} AND o.is_word=true
  `);
  const [chapters] = await db.execute(sql`
    SELECT count(*)::int AS chapters, COALESCE(sum(token_count),0)::int AS words
    FROM text_chapters WHERE text_id=${textId}
  `);
  const [stale] = await db.execute(sql`
    SELECT EXISTS(SELECT 1 FROM hindi_chapter_analyses a JOIN text_chapters c ON c.id=a.chapter_id
      JOIN hindi_dictionary_state d ON d.id=1 WHERE c.text_id=${textId} AND a.revision<>d.revision) AS stale
  `);
  const denominator = Number(counts?.occurrences ?? 0);
  const percent = (count: unknown) => userId && denominator ? Math.round(Number(count) / denominator * 1000) / 10 : null;
  const [copy] = userId ? await db.select({ textId: schema.officialTextCopies.textId }).from(schema.officialTextCopies)
    .where(and(eq(schema.officialTextCopies.sourceTextId, textId), eq(schema.officialTextCopies.userId, userId))).limit(1) : [];
  const { ownerId, ...metadata } = text;
  return { ...metadata, words: Number(chapters?.words ?? 0), chapters: Number(chapters?.chapters ?? 0),
    uniqueWords: Number(counts?.unique_words ?? 0), unresolved: Number(counts?.unresolved ?? 0),
    knownPct: percent(counts?.known), learningPct: percent(counts?.learning), analysisStale: Boolean(stale?.stale),
    personalTextId: copy?.textId ?? (userId && ownerId === userId ? textId : null) };
}

export type OfficialDeckScope = 'unknown' | 'learning' | 'all';

/** A catalog deck contains dictionary vocabulary and frequency, never book passages. */
export async function getOfficialBookCards(textId: string, userId: string, scope: OfficialDeckScope): Promise<AnkiCard[]> {
  if (!(await getOfficialBook(textId))) throw new OfficialBookError('Book not found', 404);
  const rows = await db.execute(sql`
    SELECT l.id,l.headword,l.pos,l.gloss_default,count(*)::int AS frequency
    FROM vocabulary_occurrences o JOIN text_chapters c ON c.id=o.chapter_id
    JOIN lemmas l ON l.id=o.lemma_id
    LEFT JOIN user_known_lemmas k ON k.lemma_id=l.id AND k.user_id=${userId}
    WHERE c.text_id=${textId} AND o.is_word=true
      AND (${scope}='all' OR (${scope}='unknown' AND COALESCE(k.status::text,'unknown')='unknown')
        OR (${scope}='learning' AND k.status='learning'))
    GROUP BY l.id ORDER BY frequency DESC,l.headword,l.pos,l.id
  `);
  return rows.map((row) => ({ id: String(row.id), word: String(row.headword), pos: String(row.pos),
    definition: String(row.gloss_default ?? ''), frequency: Number(row.frequency), minedSentence: null, samples: [] }));
}

/** Idempotent staff import; copied analyses and selections remain independent of the catalog. */
export async function importOfficialBook(textId: string, userId: string): Promise<string> {
  if (!(await isStaffMember(userId))) throw new OfficialBookError('Staff access required', 403);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${textId}),hashtext(${userId}))`);
    const [existing] = await tx.select().from(schema.officialTextCopies)
      .where(and(eq(schema.officialTextCopies.sourceTextId, textId), eq(schema.officialTextCopies.userId, userId))).limit(1);
    if (existing) return existing.textId;
    const [source] = await tx.select().from(schema.texts)
      .where(and(eq(schema.texts.id, textId), eq(schema.texts.visibility, 'official'))).limit(1).for('share');
    if (!source) throw new OfficialBookError('Book not found', 404);
    if (source.ownerId === userId) return source.id;
    if (source.status !== 'ready' || source.sourceType === 'pdf') throw new OfficialBookError('This book is not ready to import', 400);
    const copyId = randomUUID();
    await tx.insert(schema.texts).values({ id: copyId, ownerId: userId, language: source.language,
      title: source.title, sourceType: source.sourceType, status: 'ready', visibility: 'private', staffOnly: source.staffOnly });
    const chapters = await tx.select().from(schema.textChapters).where(eq(schema.textChapters.textId, textId));
    for (const chapter of chapters) {
      const chapterId = randomUUID();
      await tx.insert(schema.textChapters).values({ id: chapterId, textId: copyId, idx: chapter.idx,
        title: chapter.title, body: chapter.body, tokenCount: chapter.tokenCount });
      await tx.execute(sql`INSERT INTO text_tokens(chapter_id,idx,surface,lemma_id,lemma_candidates,features,
          is_ambiguous,is_oov,is_word,sentence_idx,romanization,number_forms,bbox)
        SELECT ${chapterId},idx,surface,lemma_id,lemma_candidates,features,is_ambiguous,is_oov,is_word,
          sentence_idx,romanization,number_forms,bbox FROM text_tokens WHERE chapter_id=${chapter.id}`);
      await tx.execute(sql`INSERT INTO hindi_occurrences
        SELECT ${chapterId},start_idx,end_idx,lemma_id,source_start,source_end,rules
        FROM hindi_occurrences WHERE chapter_id=${chapter.id}`);
      await tx.execute(sql`INSERT INTO hindi_chapter_analyses
        SELECT ${chapterId},revision,parser_version,source_words,unresolved_words,stats
        FROM hindi_chapter_analyses WHERE chapter_id=${chapter.id}`);
      await tx.execute(sql`INSERT INTO hindi_context_choices
        SELECT ${chapterId},source_occurrence_id,source_start,source_end,selected_lemma_ids,candidate_lemma_ids,
          origin,status,metadata FROM hindi_context_choices WHERE chapter_id=${chapter.id}`);
      await tx.execute(sql`INSERT INTO phrase_chapter_spans(phrase_id,chapter_id,start_token_idx,end_token_idx)
        SELECT phrase_id,${chapterId},start_token_idx,end_token_idx FROM phrase_chapter_spans WHERE chapter_id=${chapter.id}`);
    }
    await tx.insert(schema.officialTextCopies).values({ sourceTextId: textId, userId, textId: copyId });
    return copyId;
  });
}
