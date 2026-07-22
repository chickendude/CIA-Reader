/**
 * Object-storage abstraction for PDF page images.
 *
 * PDFs are rasterized page-by-page in the browser (pdf.js) and the
 * rendered images are uploaded to the server; the source PDF itself
 * never leaves the client. The only persisted artifact is one image
 * per page, shown in the reader with clickable word overlays.
 *
 * Mirrors `audio/storage.ts` deliberately so the two share a mental
 * model and a future S3 backend (Hetzner Object Storage, T-13.x) drops
 * in the same way:
 *
 *   - 'local' (default in dev / CI): writes under a directory keyed by
 *     `PDF_LOCAL_ROOT`.
 *   - 's3' (prod): wired in the deployment ticket.
 *
 * The interface is intentionally small (`put`, `delete`, `urlFor`) so a
 * route handler doesn't reason about which backend is active.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface PdfStorage {
  /** Writes the page image blob under `key`. */
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  /** Reads a blob back. Throws when the key doesn't exist. Needed by
   *  server-side consumers (the scan OCR service reads page images to
   *  post them to the NLP service); the reader itself never calls this
   *  — it fetches `urlFor(key)`. */
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Returns the URL the reader should fetch. May be a local
   *  /pdf-assets/<key> path (dev) or a presigned S3 URL (prod). */
  urlFor(key: string): string;
}

const LOCAL_ROOT = process.env.PDF_LOCAL_ROOT ?? '/tmp/ciareader-pdf';

class LocalPdfStorage implements PdfStorage {
  async put(key: string, body: Uint8Array, mime: string): Promise<void> {
    // mime is recorded on the chapter row; the /pdf-assets route picks
    // Content-Type from the extension, so the local blob isn't tagged.
    void mime;
    const file = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }
  async get(key: string): Promise<Uint8Array> {
    const file = path.join(LOCAL_ROOT, key);
    return new Uint8Array(await fs.readFile(file));
  }
  async delete(key: string): Promise<void> {
    const file = path.join(LOCAL_ROOT, key);
    try {
      await fs.unlink(file);
    } catch {
      // Idempotent — missing key is not an error.
    }
  }
  urlFor(key: string): string {
    return isScanKey(key) ? `/scan-assets/${key}` : `/pdf-assets/${key}`;
  }
}

let singleton: PdfStorage | null = null;

export function getPdfStorage(): PdfStorage {
  if (!singleton) {
    // S3 wiring lives in the deployment ticket (T-13.x). For dev +
    // tests the local backend is the only branch.
    singleton = new LocalPdfStorage();
  }
  return singleton;
}

export function setPdfStorage(s: PdfStorage): void {
  singleton = s;
}

/**
 * Storage key for a page image. One image per (text, page index). The
 * extension is derived from the chosen image mime so the served file's
 * Content-Type matches. Keying by `idx` (not a random id) means a
 * re-OCR / re-render of the same page overwrites in place.
 */
export function pageImageStorageKey(
  textId: string,
  idx: number,
  mime: string,
): string {
  const ext = extForMime(mime);
  return `texts/${textId}/pages/${idx}.${ext}`;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export const MIME_BY_EXT: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? 'webp';
}

export function isAllowedPageImageMime(mime: string): boolean {
  return mime.toLowerCase() in EXT_BY_MIME;
}

/** Hard cap on a single uploaded page image. A 200-DPI A4 page as WebP
 *  is well under 1MB; 8MB leaves generous headroom for dense colour
 *  scans while keeping a single page from pinning memory. */
export const MAX_PAGE_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Storage key for a dictionary scan page image (transcription
 * workbench). Keyed by (dictionary, volume, pdf page index) so a
 * re-ingest of the same volume overwrites in place, mirroring
 * `pageImageStorageKey`'s idempotency rationale.
 */
export function scanPageStorageKey(
  dictionarySlug: string,
  volumeNumber: number,
  pdfPageIndex: number,
  mime: string,
): string {
  const ext = extForMime(mime);
  const vol = String(volumeNumber).padStart(2, '0');
  return `scans/${dictionarySlug}/v${vol}/pages/${pdfPageIndex}.${ext}`;
}

/** Scan-page keys live under their own prefix with their own (curator-
 *  gated) serving route — `textIdFromPageKey` would rightly 404 them. */
export function isScanKey(key: string): boolean {
  return key.startsWith('scans/');
}

/** Extract the owning text id from a `texts/<uuid>/pages/...` key so the
 *  serving route can run a `canReadText` gate. Returns null for any key
 *  that doesn't match the expected page-image shape. */
export function textIdFromPageKey(key: string): string | null {
  const m = key.match(
    /^texts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/pages\//i,
  );
  return m ? m[1]! : null;
}
