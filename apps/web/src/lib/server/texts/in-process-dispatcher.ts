import type { ReprocessProgress } from '$lib/text/reprocess.js';
import { eq } from 'drizzle-orm';

import type { LanguageCode } from '@ciareader/shared-types';

import { db, schema } from '../db/index.js';
import { nlpClient, type NlpToken } from '../nlp-client.js';
import type {
  Text,
  TextChapter,
  TextToken,
} from '../db/schema.js';
import {
  markTextFailed,
  markTextProcessing,
  markTextReady,
  type JobDispatcher,
} from './jobs.js';
import { rebuildChapterSpans } from './phrase-spans.js';
import { persistHindiTokens } from './hindidb.js';
import type { HindiAnalysis } from '../nlp-client.js';

export async function persistTokens(args: {
  chapterId: string;
  language: LanguageCode;
  tokens: Array<
    NlpToken & { bbox?: { x: number; y: number; w: number; h: number } | null }
  >;
  hindiAnalysis?: HindiAnalysis | null;
}): Promise<number> {
  const { chapterId, language, tokens } = args;
  if (language === 'hi' && args.hindiAnalysis) {
    return persistHindiTokens(chapterId, tokens, args.hindiAnalysis);
  }
  const rows = tokens.map((t) => {
    const matches = t.candidates.flatMap((c) => c.dictionary_id
      ? [{ lemmaId: c.dictionary_id, features: c.features, score: c.score }]
      : []);
    return {
      chapterId,
      idx: t.idx,
      surface: t.surface,
      lemmaId: matches[0]?.lemmaId ?? null,
      lemmaCandidates: matches,
      features: matches[0]?.features ?? {},
      isAmbiguous: matches.length > 1,
      isOov: t.is_word && matches.length === 0,
      isWord: t.is_word,
      sentenceIdx: t.sentence_idx ?? 0,
      romanization: t.romanization,
      numberForms: t.number_forms ?? null,
      bbox: t.bbox ?? null,
    };
  }) satisfies Array<Omit<TextToken, 'id'>>;
  await db.transaction(async (tx) => {
    await tx.delete(schema.textTokens).where(eq(schema.textTokens.chapterId, chapterId));
    // A whole chapter can exceed PostgreSQL's parameter limit in one insert.
    for (let off = 0; off < rows.length; off += 1000) {
      await tx.insert(schema.textTokens).values(rows.slice(off, off + 1000));
    }
  });
  await rebuildChapterSpans({ chapterId, language });
  return rows.length;
}

async function processChapter(
  chapter: Pick<TextChapter, 'id' | 'body'>,
  language: LanguageCode,
): Promise<number> {
  const result = await nlpClient.process(language, chapter.body);
  return persistTokens({
    chapterId: chapter.id,
    language,
    tokens: result.tokens,
    hindiAnalysis: result.hindi_analysis,
  });
}

/**
 * Run the full process flow for one text in the foreground. Returns
 * the count of tokens written, or throws if any chapter fails.
 *
 * Exported for tests + the admin re-process endpoint.
 */
export async function processTextNow(textId: string, onProgress?: ReprocessProgress): Promise<number> {
  const [text] = (await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1)) as Text[];
  if (!text) throw new Error(`Text ${textId} not found`);
  const chapters = (await db
    .select({ id: schema.textChapters.id, body: schema.textChapters.body, pageImageKey: schema.textChapters.pageImageKey })
    .from(schema.textChapters)
    .where(eq(schema.textChapters.textId, textId))
    .orderBy(schema.textChapters.idx)) as Array<Pick<TextChapter, 'id' | 'body' | 'pageImageKey'>>;

  await markTextProcessing(text.id);
  try {
    onProgress?.(0, chapters.length);
    let total = 0;
    for (const [idx, chapter] of chapters.entries()) {
      if (!chapter.pageImageKey || chapter.body.trim()) {
        total += await processChapter(chapter, text.language);
      }
      onProgress?.(idx + 1, chapters.length);
    }
    await markTextReady(text.id);
    return total;
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await markTextFailed(text.id, message);
    throw e;
  }
}

/**
 * Background-fire dispatcher. Drops the work onto a microtask so the
 * caller (the upload action) doesn't wait for NLP — the user sees
 * the redirect-to-reader immediately and the status badge polls
 * itself ready.
 */
export const inProcessDispatcher: JobDispatcher = {
  async dispatch({ textId }) {
    // Don't await — fire-and-forget. The polling endpoint will pick
    // up the status flips. We `void` the promise but log any
    // rejection so the user doesn't get a silent stuck-pending.
    queueMicrotask(() => {
      processTextNow(textId).catch((e) => {
        console.error(`[nlp] process ${textId} failed:`, e);
      });
    });
  },
};
