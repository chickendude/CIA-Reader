/**
 * Scan-volume ingestion orchestration (transcription workbench).
 *
 * Pure loop over the volume's pages: rasterize → store image → upsert
 * `scan_pages` row. All effects are injected (rasterizer, storage,
 * repo) so the logic is unit-testable; the poppler shell-outs and the
 * Drizzle repo live in scripts/ingest-scan.ts, which is the only
 * caller. Idempotent/resumable: pages that already have a row are
 * skipped unless `force`, so a killed run resumes where it left off —
 * the same contract as the DSAL scraper's response cache.
 */
import { jpegDimensions } from './jpeg.js';

export type IngestOptions = {
  dictionarySlug: string;
  volumeNumber: number;
  /** printed page = pdf page index + offset. */
  pageOffset: number;
  /** Inclusive printed-page range this volume covers; pages mapping
   *  outside it get printed_page = null (front/back matter). */
  printedStart?: number;
  printedEnd?: number;
  sourceUrl: string;
  sourceNote?: string;
  dpi: number;
  force?: boolean;
};

export type IngestVolumeRecord = {
  id: string;
  pageCount: number;
};

export type IngestRepo = {
  upsertVolume(input: {
    dictionarySlug: string;
    volumeNumber: number;
    sourceUrl: string;
    sourceNote?: string;
    pageCount: number;
    pageOffset: number;
    printedPageStart?: number;
    printedPageEnd?: number;
  }): Promise<IngestVolumeRecord>;
  hasPage(volumeId: string, pdfPageIndex: number): Promise<boolean>;
  upsertPage(input: {
    volumeId: string;
    pdfPageIndex: number;
    printedPage: number | null;
    imageKey: string;
    imageMime: string;
    width: number;
    height: number;
  }): Promise<void>;
};

export type IngestDeps = {
  /** Total pages in the PDF (pdfinfo). */
  pageCount(): Promise<number>;
  /** Rasterize one 0-based page to JPEG bytes (pdftoppm). */
  rasterizePage(pdfPageIndex: number, dpi: number): Promise<Uint8Array>;
  storeImage(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  imageKeyFor(pdfPageIndex: number, mime: string): string;
  repo: IngestRepo;
  log?: (message: string) => void;
};

export type IngestSummary = { pages: number; written: number; skipped: number };

/** Printed page number for a pdf page, or null outside the calibrated range. */
export function printedPageFor(
  pdfPageIndex: number,
  opts: Pick<IngestOptions, 'pageOffset' | 'printedStart' | 'printedEnd'>,
): number | null {
  const printed = pdfPageIndex + opts.pageOffset;
  if (printed < 1) return null;
  if (opts.printedStart !== undefined && printed < opts.printedStart) return null;
  if (opts.printedEnd !== undefined && printed > opts.printedEnd) return null;
  return printed;
}

export async function runScanIngest(opts: IngestOptions, deps: IngestDeps): Promise<IngestSummary> {
  const log = deps.log ?? (() => {});
  const pages = await deps.pageCount();
  if (pages < 1) throw new Error('PDF reports zero pages');

  const volume = await deps.repo.upsertVolume({
    dictionarySlug: opts.dictionarySlug,
    volumeNumber: opts.volumeNumber,
    sourceUrl: opts.sourceUrl,
    sourceNote: opts.sourceNote,
    pageCount: pages,
    pageOffset: opts.pageOffset,
    printedPageStart: opts.printedStart,
    printedPageEnd: opts.printedEnd,
  });

  const summary: IngestSummary = { pages, written: 0, skipped: 0 };
  for (let idx = 0; idx < pages; idx += 1) {
    if (!opts.force && (await deps.repo.hasPage(volume.id, idx))) {
      summary.skipped += 1;
      continue;
    }
    const bytes = await deps.rasterizePage(idx, opts.dpi);
    const dims = jpegDimensions(bytes);
    if (!dims) throw new Error(`page ${idx}: rasterizer produced an unparseable JPEG`);
    const mime = 'image/jpeg';
    const key = deps.imageKeyFor(idx, mime);
    await deps.storeImage(key, bytes, mime);
    await deps.repo.upsertPage({
      volumeId: volume.id,
      pdfPageIndex: idx,
      printedPage: printedPageFor(idx, opts),
      imageKey: key,
      imageMime: mime,
      width: dims.width,
      height: dims.height,
    });
    summary.written += 1;
    if (summary.written % 50 === 0) log(`[ingest] ${summary.written}/${pages} pages`);
  }
  return summary;
}
