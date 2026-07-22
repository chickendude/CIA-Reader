/**
 * On-demand, cached raw OCR for scan pages (transcription workbench).
 *
 * The first time a curator opens a page, we read its image back from
 * storage, post it to the NLP service in `mode: 'raw'` (no language
 * pipeline — dictionary pages mix scripts), and cache the text + word
 * boxes on the `scan_pages` row. Every later open is a cache hit; a
 * page pays for exactly one Google Vision call ever (~$1.5/1000 pages,
 * so even walking all ~9,500 Praharaj pages is ~$15 total).
 *
 * Failures are recorded (`ocr_status = 'failed'`) and retried on the
 * next open — a transient NLP-service outage doesn't poison the page.
 *
 * Effects are injected for tests; `ensureScanPageOcr` is the
 * drizzle+storage+nlpClient-bound entry the routes use.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { nlpClient } from '../nlp-client.js';
import { getPdfStorage } from '../pdf/storage.js';
import type { ScanOcrWord, ScanPage } from '../db/schema.js';

export type ScanOcrDeps = {
  loadPage(scanPageId: string): Promise<ScanPage | null>;
  saveOcr(
    scanPageId: string,
    result: {
      status: 'ok' | 'failed';
      engine: string;
      text: string | null;
      words: ScanOcrWord[] | null;
    },
  ): Promise<void>;
  fetchImage(imageKey: string): Promise<Uint8Array>;
  runOcr(
    imageBytes: Uint8Array,
    page: { width: number; height: number; mime: string },
  ): Promise<{ body: string; words: ScanOcrWord[] }>;
};

export async function ensureScanPageOcrWith(
  deps: ScanOcrDeps,
  scanPageId: string,
): Promise<ScanPage> {
  const page = await deps.loadPage(scanPageId);
  if (!page) throw new Error(`scan page ${scanPageId} not found`);
  if (page.ocrStatus === 'ok') return page;

  try {
    const bytes = await deps.fetchImage(page.imageKey);
    const { body, words } = await deps.runOcr(bytes, {
      width: page.width,
      height: page.height,
      mime: page.imageMime,
    });
    await deps.saveOcr(scanPageId, { status: 'ok', engine: 'vision-raw', text: body, words });
    const updated = await deps.loadPage(scanPageId);
    return updated ?? page;
  } catch (err) {
    await deps
      .saveOcr(scanPageId, { status: 'failed', engine: 'vision-raw', text: null, words: null })
      .catch(() => {});
    throw err;
  }
}

/** Compact the NLP raw-mode response into the cached word list: word
 *  tokens with a box only — separators and boxless tokens drop out. */
export function toScanOcrWords(
  tokens: Array<{ surface: string; is_word: boolean; bbox: { x: number; y: number; w: number; h: number } | null }>,
): ScanOcrWord[] {
  return tokens
    .filter((t) => t.is_word && t.bbox)
    .map((t) => ({ s: t.surface, x: t.bbox!.x, y: t.bbox!.y, w: t.bbox!.w, h: t.bbox!.h }));
}

const defaultDeps: ScanOcrDeps = {
  async loadPage(scanPageId) {
    const rows = await db
      .select()
      .from(schema.scanPages)
      .where(eq(schema.scanPages.id, scanPageId))
      .limit(1);
    return rows[0] ?? null;
  },
  async saveOcr(scanPageId, result) {
    await db
      .update(schema.scanPages)
      .set({
        ocrStatus: result.status,
        ocrEngine: result.engine,
        ocrText: result.text,
        ocrWords: result.words,
        ocrAt: new Date(),
      })
      .where(eq(schema.scanPages.id, scanPageId));
  },
  fetchImage(imageKey) {
    return getPdfStorage().get(imageKey);
  },
  async runOcr(imageBytes, page) {
    const res = await nlpClient.ocr('', imageBytes, {
      mode: 'raw',
      width: page.width,
      height: page.height,
      mime: page.mime,
    });
    return { body: res.body, words: toScanOcrWords(res.tokens) };
  },
};

export function ensureScanPageOcr(scanPageId: string): Promise<ScanPage> {
  return ensureScanPageOcrWith(defaultDeps, scanPageId);
}
