/**
 * PDF per-page processing.
 *
 * A PDF text is one `texts` row (sourceType 'pdf') with one
 * `text_chapters` row per page, created empty by `createPdfText`. The
 * browser rasterizes each page client-side and uploads the image; the
 * per-page ingest endpoint (`/api/v1/texts/[id]/pages/[idx]`) calls
 * `processPdfPage`, which:
 *
 *   1. stores the page image (the only persisted artifact),
 *   2. OCRs it via the NLP `/ocr` endpoint (Vision, or the client's
 *      born-digital text layer) → tokens + per-token bbox,
 *   3. fills the page chapter's body + image metadata,
 *   4. resolves + persists tokens through the shared `persistTokens`
 *      (same lemma resolution the text pipeline uses), and
 *   5. flips the text to `ready` once every page has been processed.
 *
 * Pages arrive as independent HTTP requests, so unlike the text
 * dispatcher there's no single "process the whole text" pass — each page
 * loads its own lemma index. For the lemma table sizes we have that's an
 * acceptable per-page cost; a process-wide cache is a later optimization.
 */
import { and, count, eq, isNotNull } from 'drizzle-orm';

import type { LanguageCode } from '@ciareader/shared-types';

import { db, schema } from '../db/index.js';
import type { Text } from '../db/schema.js';
import { nlpClient, type BornDigitalPayload } from '../nlp-client.js';
import { estimateTokenCount } from './chunking.js';
import { loadLemmaIndex, persistTokens } from './in-process-dispatcher.js';
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

    const index = await loadLemmaIndex(language);
    const tokenCount = await persistTokens({
      chapterId: chapter.id,
      language,
      index,
      tokens: ocr.tokens,
      proposedPhrases: ocr.proposed_phrases,
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

/**
 * Re-run NLP over an already-imported PDF **without calling Vision**.
 *
 * The expensive OCR result is already persisted: each page's text lives in
 * the stored tokens (their surfaces concatenate to the page text) and each
 * word token carries its bounding box. We replay that geometry as an OCR
 * "layout" so the NLP service re-tokenizes + re-resolves lemmas with the
 * current model/dictionary and recomputes boxes — but pays nothing for
 * OCR and needs no re-upload. Use after a model/dictionary change (e.g.
 * switching the Basque pipeline on) instead of re-importing.
 */
export async function reprocessPdfText(textId: string): Promise<number> {
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

    const index = await loadLemmaIndex(language);
    let total = 0;
    for (const ch of chapters) {
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
      if (toks.length === 0) continue;

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
        index,
        tokens: ocr.tokens,
        proposedPhrases: ocr.proposed_phrases,
      });
    }
    await markTextReady(textId);
    return total;
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await markTextFailed(textId, message);
    throw e;
  }
}
