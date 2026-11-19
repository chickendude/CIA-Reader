/** Each uploaded PDF page has its own image, text, and word positions.
 * Look up its words in the dictionary and mark the book ready when all pages are saved.
 */
import type { ReprocessProgress } from '$lib/text/reprocess.js';
import { and, count, eq, isNotNull } from 'drizzle-orm';

import type { LanguageCode } from '@ciareader/shared-types';

import { db, schema } from '../db/index.js';
import type { Text } from '../db/schema.js';
import { nlpClient, type BornDigitalPayload } from '../nlp-client.js';
import { estimateTokenCount } from './chunking.js';
import { persistTokens } from './in-process-dispatcher.js';
import { markTextFailed, markTextProcessing, markTextReady } from './jobs.js';
import { getPdfStorage, pageImageStorageKey } from '../pdf/storage.js';

export class PdfPageError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'PdfPageError';
  }
}

export type ProcessPdfPageInput = {
  textId: string;
  /** Page index (0-based) — matches the page chapter's `idx`. */
  idx: number;
  imageBytes: Uint8Array;
  /** Image mime (image/webp | image/jpeg | image/png). */
  mime: string;
  /** Rendered page-image pixel dimensions, from the client. */
  width: number;
  height: number;
  /** 'vision' (default) or 'vision_llm' (on-demand AI proofread). */
  engine?: 'vision' | 'vision_llm';
  /** Client-extracted PDF text layer for born-digital pages — when set,
   *  OCR is skipped server-side. */
  bornDigital?: BornDigitalPayload | null;
};

export type ProcessPdfPageResult = {
  chapterId: string;
  /** Number of word/non-word tokens persisted for the page. */
  tokenCount: number;
  /** True when this page was the last to be processed and the text
   *  flipped to `ready`. */
  complete: boolean;
};

/**
 * Process one uploaded PDF page image end-to-end. Throws `PdfPageError`
 * for caller-fixable problems (unknown text / page) and flips the text to
 * `failed` (re-raising) if OCR or persistence errors out.
 */
export async function processPdfPage(
  input: ProcessPdfPageInput,
): Promise<ProcessPdfPageResult> {
  const [text] = (await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, input.textId))
    .limit(1)) as Text[];
  if (!text) throw new PdfPageError('text not found', 404);
  if (text.sourceType !== 'pdf') {
    throw new PdfPageError('text is not a PDF', 400);
  }

  const [chapter] = (await db
    .select({ id: schema.textChapters.id })
    .from(schema.textChapters)
    .where(
      and(
        eq(schema.textChapters.textId, input.textId),
        eq(schema.textChapters.idx, input.idx),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  if (!chapter) throw new PdfPageError('page not found', 404);

  const language = text.language as LanguageCode;

  try {
    // First page in flips the text from queued → processing.
    if (text.status === 'pending') {
      await markTextProcessing(input.textId);
    }

    const key = pageImageStorageKey(input.textId, input.idx, input.mime);
    await getPdfStorage().put(key, input.imageBytes, input.mime);

    const ocr = await nlpClient.ocr(language, input.imageBytes, {
      width: input.width,
      height: input.height,
      mime: input.mime,
      engine: input.engine,
      bornDigital: input.bornDigital,
    });

    await db
      .update(schema.textChapters)
      .set({
        body: ocr.body,
        tokenCount: estimateTokenCount(ocr.body),
        pageImageKey: key,
        pageImageMime: input.mime,
        pageWidth: ocr.width,
        pageHeight: ocr.height,
      })
      .where(eq(schema.textChapters.id, chapter.id));

    const tokenCount = await persistTokens({
      chapterId: chapter.id,
      language,
      tokens: ocr.tokens,
      hindiAnalysis: ocr.hindi_analysis,
    });

    // A page counts as done once it has an image key. Mark the text
    // ready when every page chapter has been processed (token-count
    // would wrongly exclude legitimately blank pages).
    const [totals] = await db
      .select({ total: count() })
      .from(schema.textChapters)
      .where(eq(schema.textChapters.textId, input.textId));
    const [done] = await db
      .select({ done: count() })
      .from(schema.textChapters)
      .where(
        and(
          eq(schema.textChapters.textId, input.textId),
          isNotNull(schema.textChapters.pageImageKey),
        ),
      );
    const complete = Number(done?.done ?? 0) >= Number(totals?.total ?? 0);
    if (complete) {
      await markTextReady(input.textId);
    }

    return { chapterId: chapter.id, tokenCount, complete };
  } catch (e) {
    if (e instanceof PdfPageError) throw e;
    const message = (e as Error).message ?? String(e);
    await markTextFailed(input.textId, message);
    throw e;
  }
}

/** Refresh dictionary matches using the saved page text and word positions. */
export async function reprocessPdfText(textId: string, onProgress?: ReprocessProgress): Promise<number> {
  const [text] = (await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1)) as Text[];
  if (!text) throw new PdfPageError('text not found', 404);
  if (text.sourceType !== 'pdf') {
    throw new PdfPageError('text is not a PDF', 400);
  }
  const language = text.language as LanguageCode;

  await markTextProcessing(textId);
  try {
    const chapters = (await db
      .select({
        id: schema.textChapters.id,
        pageWidth: schema.textChapters.pageWidth,
        pageHeight: schema.textChapters.pageHeight,
      })
      .from(schema.textChapters)
      .where(eq(schema.textChapters.textId, textId))
      .orderBy(schema.textChapters.idx)) as Array<{
      id: string;
      pageWidth: number | null;
      pageHeight: number | null;
    }>;

    onProgress?.(0, chapters.length);
    let total = 0;
    for (const [idx, ch] of chapters.entries()) {
      const toks = (await db
        .select({
          surface: schema.textTokens.surface,
          bbox: schema.textTokens.bbox,
        })
        .from(schema.textTokens)
        .where(eq(schema.textTokens.chapterId, ch.id))
        .orderBy(schema.textTokens.idx)) as Array<{
        surface: string;
        bbox: { x: number; y: number; w: number; h: number } | null;
      }>;
      // No stored tokens → page was never OCR'd; nothing to replay.
      if (toks.length === 0) {
        onProgress?.(idx + 1, chapters.length);
        continue;
      }

      // Rebuild the page text + one box per character from the tokens.
      let pageText = '';
      const charBoxes: Array<[number, number, number, number] | null> = [];
      for (const t of toks) {
        const box: [number, number, number, number] | null = t.bbox
          ? [t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h]
          : null;
        // One entry per code point (matches Python's len(text)).
        charBoxes.push(...Array.from(t.surface, () => box));
        pageText += t.surface;
      }

      const ocr = await nlpClient.ocr(language, new Uint8Array(0), {
        width: ch.pageWidth ?? 1,
        height: ch.pageHeight ?? 1,
        layout: { text: pageText, charBoxes },
      });
      total += await persistTokens({
        chapterId: ch.id,
        language,
        tokens: ocr.tokens,
        hindiAnalysis: ocr.hindi_analysis,
      });
      onProgress?.(idx + 1, chapters.length);
    }
    await markTextReady(textId);
    return total;
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await markTextFailed(textId, message);
    throw e;
  }
}
