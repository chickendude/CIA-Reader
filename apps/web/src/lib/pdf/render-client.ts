/**
 * Client-side PDF rasterization + text-layer extraction (browser only).
 *
 * The browser does the CPU-heavy work — rendering each page to an image
 * with pdf.js — so the server never rasterizes and the source PDF never
 * leaves the user's machine. For born-digital PDFs we also pull the
 * embedded text layer (text + per-run boxes) so the server can skip OCR.
 *
 * pdf.js is imported dynamically so it never loads during SSR; call these
 * functions from browser event handlers only.
 */

/** One run from the PDF text layer, normalized to 0..1, top-left origin.
 *  Mirrors the server-side `BornDigitalItem`. */
export interface BornDigitalItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  eol?: boolean;
}

export interface BornDigitalPayload {
  items: BornDigitalItem[];
}

export interface RenderedPage {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  /** Set only when the text layer was used and the page had text. */
  bornDigital: BornDigitalPayload | null;
}

export interface LoadedPdf {
  numPages: number;
  /** True when the document carries an embedded text layer (any
   *  extractable text). NOTE: scanned books often ship a *poor* OCR
   *  text layer, so this being true does NOT mean the text is good —
   *  see `isScanned`. */
  hasTextLayer: boolean;
  /** True when the sampled pages are dominated by a full-page image —
   *  i.e. a scan. A scanned PDF should be OCR'd even if it carries an
   *  embedded (usually bad) text layer, so this drives the default to
   *  Vision OCR rather than "use built-in text". */
  isScanned: boolean;
  doc: import('pdfjs-dist').PDFDocumentProxy;
}

export interface ImportProgress {
  done: number;
  total: number;
}

// 150 DPI keeps page images small enough to upload quickly while staying
// crisp enough for Vision OCR and comfortable on-screen reading.
const TARGET_DPI = 150;
const PDF_POINTS_PER_INCH = 72;
const IMAGE_MIME = 'image/webp';
const IMAGE_QUALITY = 0.85;
// A real text layer yields plenty of characters in the first few pages; a
// scan yields ~none.
const TEXT_LAYER_MIN_CHARS = 40;
// Pages sampled to classify the document (text layer + scanned-ness).
const CLASSIFY_SAMPLE_PAGES = 5;
// A single painted image covering at least this fraction of the page marks
// the page as a scan (image-dominated).
const SCANNED_IMAGE_COVERAGE = 0.5;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Vite resolves `?url` to the emitted worker asset URL (typed via
      // vite/client ambient declarations).
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url'))
        .default as string;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * Largest single image-paint coverage on a page, as a fraction of page
 * area. Walks the operator list tracking the current transform matrix
 * (CTM) — an image is painted into the unit square transformed by the
 * CTM, so its on-page size is read straight off the matrix. A scanned
 * page is essentially one image covering the whole page (~1.0); a
 * born-digital text page has little or no image area.
 *
 * Pure + parameterized (OPS codes + matrix multiply passed in) so it can
 * be unit-tested without pdf.js.
 */
export function maxImagePaintCoverage(
  fnArray: number[],
  argsArray: unknown[],
  codes: { save: number; restore: number; transform: number; image: number[] },
  multiply: (m1: number[], m2: number[]) => number[],
  pageWidth: number,
  pageHeight: number,
): number {
  const pageArea = pageWidth * pageHeight;
  if (!(pageArea > 0)) return 0;
  const imageOps = new Set(codes.image);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let maxArea = 0;
  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    if (fn === undefined) continue;
    if (fn === codes.save) {
      stack.push(ctm.slice());
    } else if (fn === codes.restore) {
      const prev = stack.pop();
      if (prev) ctm = prev;
    } else if (fn === codes.transform) {
      const a = argsArray[i];
      if (Array.isArray(a) && a.length >= 6) ctm = multiply(ctm, a as number[]);
    } else if (imageOps.has(fn)) {
      const w = Math.hypot(ctm[0]!, ctm[1]!);
      const h = Math.hypot(ctm[2]!, ctm[3]!);
      maxArea = Math.max(maxArea, w * h);
    }
  }
  return maxArea / pageArea;
}

/** Load a PDF and classify it: does it have an embedded text layer, and
 *  is it a scan (image-dominated)? */
export async function loadPdf(file: File): Promise<LoadedPdf> {
  const pdfjs = await loadPdfjs();
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const { hasTextLayer, isScanned } = await classifyPdf(pdfjs, doc);
  return { numPages: doc.numPages, hasTextLayer, isScanned, doc };
}

async function classifyPdf(
  pdfjs: typeof import('pdfjs-dist'),
  doc: import('pdfjs-dist').PDFDocumentProxy,
): Promise<{ hasTextLayer: boolean; isScanned: boolean }> {
  const ops = pdfjs.OPS as unknown as Record<string, number>;
  // -1 is a safe sentinel (op codes are >= 0, so it never matches) for the
  // rare case an OPS name is absent in some pdf.js build.
  const codes = {
    save: ops.save ?? -1,
    restore: ops.restore ?? -1,
    transform: ops.transform ?? -1,
    image: [
      ops.paintImageXObject,
      ops.paintInlineImageXObject,
      ops.paintImageMaskXObject,
      ops.paintImageXObjectRepeat,
    ].filter((c): c is number => typeof c === 'number'),
  };
  const sample = Math.min(doc.numPages, CLASSIFY_SAMPLE_PAGES);
  let chars = 0;
  let scannedPages = 0;
  for (let i = 1; i <= sample; i += 1) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if ('str' in it) chars += it.str.trim().length;
    }
    const viewport = page.getViewport({ scale: 1 });
    const opList = await page.getOperatorList();
    const coverage = maxImagePaintCoverage(
      opList.fnArray,
      opList.argsArray,
      codes,
      pdfjs.Util.transform,
      viewport.width,
      viewport.height,
    );
    if (coverage >= SCANNED_IMAGE_COVERAGE) scannedPages += 1;
    page.cleanup();
  }
  return {
    hasTextLayer: chars >= TEXT_LAYER_MIN_CHARS,
    // Most sampled pages dominated by an image → treat the doc as a scan
    // (default to OCR), even if it ships a poor embedded text layer.
    isScanned: sample > 0 && scannedPages / sample >= 0.5,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

async function extractTextItems(
  pdfjs: typeof import('pdfjs-dist'),
  page: import('pdfjs-dist').PDFPageProxy,
  viewport: import('pdfjs-dist').PageViewport,
  width: number,
  height: number,
): Promise<BornDigitalItem[]> {
  const tc = await page.getTextContent();
  const items: BornDigitalItem[] = [];
  for (const it of tc.items) {
    if (!('str' in it)) continue; // skip marked-content items
    const s = it.str;
    if (!s) {
      // Empty item that only marks an end-of-line: flag the previous run.
      if (it.hasEOL && items.length) items[items.length - 1]!.eol = true;
      continue;
    }
    // Map the text-space transform into device (canvas) coords via the
    // viewport, then read off the glyph box: x/baseline from the matrix,
    // height from the font scale, width from the item's advance.
    const t = pdfjs.Util.transform(viewport.transform, it.transform);
    const fontHeight = Math.hypot(t[1], t[3]) || Math.abs(t[3]);
    const wDev = it.width * viewport.scale;
    const xDev = t[4];
    const yTop = t[5] - fontHeight;
    items.push({
      str: s,
      x: clamp01(xDev / width),
      y: clamp01(yTop / height),
      w: clamp01(wDev / width),
      h: clamp01(fontHeight / height),
      eol: it.hasEOL === true,
    });
  }
  return items;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      IMAGE_MIME,
      IMAGE_QUALITY,
    );
  });
}

/** Render one page (1-based) to a WebP image, optionally with its text
 *  layer. */
export async function renderPage(
  doc: import('pdfjs-dist').PDFDocumentProxy,
  pageNum: number,
  useTextLayer: boolean,
): Promise<RenderedPage> {
  const pdfjs = await loadPdfjs();
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: TARGET_DPI / PDF_POINTS_PER_INCH });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const blob = await canvasToBlob(canvas);

  let bornDigital: BornDigitalPayload | null = null;
  if (useTextLayer) {
    const items = await extractTextItems(pdfjs, page, viewport, width, height);
    if (items.length) bornDigital = { items };
  }
  page.cleanup();
  return { blob, width, height, mime: IMAGE_MIME, bornDigital };
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('cancelled'));
      },
      { once: true },
    );
  });
}

/**
 * Upload one rendered page, retrying on 5xx (transient OCR errors, e.g.
 * Google billing-propagation flaps right after enabling). 4xx fails fast
 * — those are caller-fixable, not transient. The FormData is rebuilt per
 * attempt since a consumed request body can't be re-sent.
 */
async function uploadPage(
  textId: string,
  pageIdx: number,
  rendered: RenderedPage,
  signal?: AbortSignal,
): Promise<void> {
  const backoffs = [0, 3000, 6000, 10000]; // ~19s total across 4 tries
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < backoffs.length; attempt += 1) {
    if (signal?.aborted) throw new Error('cancelled');
    if (backoffs[attempt]! > 0) await delay(backoffs[attempt]!, signal);
    const form = new FormData();
    form.set('image', rendered.blob, `page-${pageIdx}.webp`);
    form.set('width', String(rendered.width));
    form.set('height', String(rendered.height));
    if (rendered.bornDigital) {
      form.set('bornDigital', JSON.stringify(rendered.bornDigital));
    }
    let res: Response;
    try {
      res = await fetch(`/api/v1/texts/${textId}/pages/${pageIdx}`, {
        method: 'POST',
        body: form,
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e as Error; // network blip — retry
      continue;
    }
    if (res.ok) return;
    const msg = await errorText(res);
    if (res.status < 500) throw new Error(msg); // 4xx: don't retry
    lastErr = new Error(msg); // 5xx: retry
  }
  throw lastErr ?? new Error('upload failed');
}

/**
 * Import an already-loaded PDF: create the text shell, then render + stream
 * each page to the server, reporting progress. Returns the new text id.
 */
export async function importLoadedPdf(
  loaded: LoadedPdf,
  opts: {
    title: string;
    language: string;
    useTextLayer: boolean;
    onProgress?: (p: ImportProgress) => void;
    signal?: AbortSignal;
  },
): Promise<{ id: string }> {
  const beginRes = await fetch('/api/v1/texts/pdf/begin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      language: opts.language,
      title: opts.title,
      pageCount: loaded.numPages,
    }),
    signal: opts.signal,
  });
  if (!beginRes.ok) throw new Error(await errorText(beginRes));
  const { id } = (await beginRes.json()) as { id: string };

  for (let p = 1; p <= loaded.numPages; p += 1) {
    if (opts.signal?.aborted) throw new Error('cancelled');
    const rendered = await renderPage(loaded.doc, p, opts.useTextLayer);
    // Server page index is 0-based; pdf.js pages are 1-based.
    await uploadPage(id, p - 1, rendered, opts.signal);
    opts.onProgress?.({ done: p, total: loaded.numPages });
  }
  await loaded.doc.cleanup();
  return { id };
}
