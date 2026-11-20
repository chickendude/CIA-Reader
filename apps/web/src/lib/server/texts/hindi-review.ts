import type { ReviewFilter } from '$lib/dictionary/review-status';
import { wordContext } from '$lib/dictionary/word-context';
import { bookAttention } from './hindi-attention.js';
import type { LanguageCode } from '@ciareader/shared-types';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { canReadText } from '../auth/can-read.js';
import { isCuratorOrAdmin } from '../dictionary/permissions.js';
import { ContextChoiceError, saveHindiContextChoice } from './hindi-context.js';
import { loadChapterTokens } from './tokens.js';
import { hindiContextPassage, suggestHindiContext } from '../hindi-ai.js';

type Actor = Pick<User, 'id' | 'role'>;
export async function reviewBooks(actor: Actor, language: LanguageCode = 'hi') {
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
      sql`${schema.texts.language}=${language} AND (${schema.texts.ownerId}=${actor.id} OR ${schema.texts.visibility}='official')`,
    )
    .orderBy(schema.texts.title);
}

export async function reviewPage(
  textId: string,
  actor: Actor,
  offset = 0,
  query = '',
  filter: ReviewFilter = 'attention',
) {
  if (!isCuratorOrAdmin(actor)) throw new ContextChoiceError('Staff access required', 403);
  const [text] = await db
    .select()
    .from(schema.texts)
    .where(and(eq(schema.texts.id, textId), eq(schema.texts.language, 'hi')))
    .limit(1);
  if (!text || !(await canReadText(actor, text)))
    throw new ContextChoiceError('Book not found', 404);
  const { rows, counts, total, offset: pageOffset } = await bookAttention(textId, query, offset, filter);
  const chapters = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const starts = chapters.get(row.chapter_id) ?? new Map<string, number>();
    starts.set(row.id, row.start);
    chapters.set(row.chapter_id, starts);
  }

  const details = new Map(await Promise.all([...chapters].map(async ([chapterId, starts]) => {
    const [rendered, words] = await Promise.all([
      loadChapterTokens(chapterId, actor.id, undefined, false, starts),
      db.select({ idx: schema.textTokens.idx, surface: schema.textTokens.surface, isWord: schema.textTokens.isWord })
        .from(schema.textTokens).where(eq(schema.textTokens.chapterId, chapterId)).orderBy(schema.textTokens.idx),
    ]);
    return [chapterId, { tokens: new Map(rendered?.map(token => [token.id, token])), words }] as const;
  })));

  const occurrences = rows.flatMap(row => {
    const chapter = details.get(row.chapter_id)!;
    const token = chapter.tokens.get(row.id);
    const context = token && wordContext(chapter.words, token.idx);
    if (!token || !context) return [];
    if (row.surface.startsWith(context.match) && row.surface.length > context.match.length) {
      context.after = context.after.slice(row.surface.length - context.match.length);
      context.match = row.surface;
    }
    return [{ token, context, surface: row.surface, status: row.status, spanEntries: row.ids ?? [],
      chapterIdx: row.chapter_idx, key: token.id + ':' + row.stop }];
  });
  return { book: { id: text.id, title: text.title }, attentionCounts: counts, total, offset: pageOffset, occurrences };
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
