import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { canReadText } from '../auth/can-read.js';
import { isCuratorOrAdmin } from '../dictionary/permissions.js';
import { ContextChoiceError, saveHindiContextChoice } from './hindi-context.js';
import { loadChapterTokens, type RenderedToken } from './tokens.js';
import { hindiContextPassage, suggestHindiContext } from '../hindi-ai.js';

type Actor = Pick<User, 'id' | 'role'>;
export async function reviewBooks(actor: Actor) {
  if (!isCuratorOrAdmin(actor)) throw new ContextChoiceError('Staff access required', 403);
  return db
    .select({
      id: schema.texts.id,
      title: schema.texts.title,
      sourceType: schema.texts.sourceType,
      visibility: schema.texts.visibility,
      canReprocess: sql<boolean>`${actor.role === 'admin'}::boolean OR ${schema.texts.ownerId} = ${actor.id}`,
    })
    .from(schema.texts)
    .where(
      sql`${schema.texts.language}='hi' AND (${schema.texts.ownerId}=${actor.id} OR ${schema.texts.visibility}='official')`,
    )
    .orderBy(schema.texts.title);
}

export async function reviewPage(
  textId: string,
  actor: Actor,
  kind: 'unparsed' | 'ambiguous',
  offset = 0,
  query = '',
) {
  if (!isCuratorOrAdmin(actor)) throw new ContextChoiceError('Staff access required', 403);
  const [text] = await db
    .select()
    .from(schema.texts)
    .where(and(eq(schema.texts.id, textId), eq(schema.texts.language, 'hi')))
    .limit(1);
  if (!text || !(await canReadText(actor, text)))
    throw new ContextChoiceError('Book not found', 404);
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = sql`ch.text_id=${textId} AND t.is_word AND t.surface ILIKE ${pattern}
    AND ${kind === 'unparsed' ? sql`t.is_oov` : sql`jsonb_array_length(t.lemma_candidates)>1`}`;
  const [count] =
    await db.execute(sql`SELECT ${kind === 'unparsed' ? sql`count(DISTINCT t.surface)` : sql`count(*)`}::int AS total
    FROM text_tokens t JOIN text_chapters ch ON ch.id=t.chapter_id WHERE ${where}`);
  const unparsed =
    kind === 'unparsed'
      ? await db.execute(sql`SELECT t.surface,count(*)::int AS frequency,
    (array_agg(t.idx ORDER BY ch.idx,t.idx))[1] AS token_idx,(array_agg(ch.idx ORDER BY ch.idx,t.idx))[1] AS chapter_idx
    FROM text_tokens t JOIN text_chapters ch ON ch.id=t.chapter_id WHERE ${where}
    GROUP BY t.surface ORDER BY frequency DESC,t.surface LIMIT 40 OFFSET ${offset}`)
      : [];
  const ambiguous: { token: RenderedToken; context: string; chapterIdx: number }[] = [];
  if (kind === 'ambiguous') {
    const rows =
      await db.execute(sql`SELECT t.id,t.chapter_id,ch.idx AS chapter_idx FROM text_tokens t
      JOIN text_chapters ch ON ch.id=t.chapter_id WHERE ${where} ORDER BY ch.idx,t.idx LIMIT 20 OFFSET ${offset}`);
    const cache = new Map<string, RenderedToken[]>();
    for (const row of rows) {
      const chapterId = String(row.chapter_id);
      if (!cache.has(chapterId))
        cache.set(chapterId, (await loadChapterTokens(chapterId, actor.id)) ?? []);
      const token = cache.get(chapterId)!.find((t) => t.id === row.id);
      if (token)
        ambiguous.push({
          token,
          context: hindiContextPassage(cache.get(chapterId)!, token.idx),
          chapterIdx: Number(row.chapter_idx),
        });
    }
  }
  return {
    book: { id: text.id, title: text.title },
    total: Number(count?.total ?? 0),
    unparsed: unparsed.map((r) => ({
      surface: String(r.surface),
      frequency: Number(r.frequency),
      tokenIdx: Number(r.token_idx),
      chapterIdx: Number(r.chapter_idx),
    })),
    ambiguous,
  };
}

export async function reviewTokenWithAi(tokenId: string, actor: Actor) {
  if (!isCuratorOrAdmin(actor)) throw new ContextChoiceError('Staff access required', 403);
  const [row] = await db
    .select({ token: schema.textTokens, text: schema.texts })
    .from(schema.textTokens)
    .innerJoin(schema.textChapters, eq(schema.textChapters.id, schema.textTokens.chapterId))
    .innerJoin(schema.texts, eq(schema.texts.id, schema.textChapters.textId))
    .where(eq(schema.textTokens.id, tokenId))
    .limit(1);
  if (!row || row.text.language !== 'hi' || !(await canReadText(actor, row.text)))
    throw new ContextChoiceError('Word not found', 404);
  const [analysis] =
    await db.execute(sql`SELECT a.revision=d.revision AS current FROM hindi_chapter_analyses a
    JOIN hindi_dictionary_state d ON d.id=1 WHERE a.chapter_id=${row.token.chapterId}`);
  if (!analysis?.current)
    throw new ContextChoiceError('Reprocess this chapter before verifying its entries', 409);
  const tokens = await loadChapterTokens(row.token.chapterId, actor.id);
  const token = tokens?.find((t) => t.id === tokenId);
  if (!token?.canVerifyContext || !token.contextVersion || !token.lemmaId)
    throw new ContextChoiceError('Cannot verify this occurrence', 403);
  if (token.selectedBy === 'human' || token.candidates.some((c) => c.selectedBy === 'human'))
    throw new ContextChoiceError('A human has already confirmed this occurrence', 409);
  const candidates = [
    {
      id: token.lemmaId,
      lemma: token.headword ?? token.surface,
      pos: token.pos ?? '',
      definition: token.glossDefault ?? '',
    },
    ...token.candidates.map((c) => ({
      id: c.lemmaId,
      lemma: c.headword,
      pos: c.pos,
      definition: c.glossDefault ?? '',
    })),
  ];
  if (candidates.length < 2) throw new ContextChoiceError('This occurrence is not ambiguous', 400);
  const context = hindiContextPassage(tokens!, token.idx);
  const suggestion = await suggestHindiContext({ surface: token.surface, context, candidates });
  await saveHindiContextChoice(
    tokenId,
    suggestion.entryIds,
    token.contextVersion,
    actor,
    suggestion,
  );
  return {
    token: (await loadChapterTokens(token.chapterId, actor.id, row.text.id))?.find((t) => t.id === tokenId),
    reason: suggestion.reason,
  };
}
