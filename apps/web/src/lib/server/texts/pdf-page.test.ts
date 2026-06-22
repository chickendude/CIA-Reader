// @vitest-environment node
/**
 * Tests for processPdfPage — the per-page PDF ingest orchestration.
 *
 * Collaborators (db, storage, NLP client, lemma resolution, status
 * helpers) are mocked so the test exercises just this module's logic:
 * store image → OCR → update chapter → persist tokens → flip the text to
 * ready when the last page lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- db mock: staged select results + recorded updates ----------------
const staged: Array<unknown[]> = [];
function stage(rows: unknown[]) {
  staged.push(rows);
}
function nextStaged(): unknown[] {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result available');
  return v;
}
const updates: Array<unknown> = [];

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}
function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn((v: unknown) => {
    updates.push(v);
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

vi.mock('../db/index.js', () => ({
  db: {
    select: () => makeSelectChain(),
    update: () => makeUpdateChain(),
  },
  schema: {
    texts: { id: 'texts.id' },
    textChapters: {
      id: 'text_chapters.id',
      textId: 'text_chapters.text_id',
      idx: 'text_chapters.idx',
      pageImageKey: 'text_chapters.page_image_key',
    },
  },
}));

const ocrMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);
vi.mock('../nlp-client.js', () => ({
  nlpClient: { ocr: (...args: unknown[]) => ocrMock(...args) },
}));

const putMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../pdf/storage.js', async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    getPdfStorage: () => ({ put: putMock, delete: vi.fn(), urlFor: (k: string) => k }),
  };
});

const persistTokensMock = vi.fn(async (..._args: unknown[]): Promise<number> => 7);
vi.mock('./in-process-dispatcher.js', () => ({
  loadLemmaIndex: vi.fn(async () => ({})),
  persistTokens: (...args: unknown[]) => persistTokensMock(...args),
}));

const markProcessing = vi.fn(async (..._args: unknown[]) => {});
const markReady = vi.fn(async (..._args: unknown[]) => {});
const markFailed = vi.fn(async (..._args: unknown[]) => {});
vi.mock('./jobs.js', () => ({
  markTextProcessing: (...a: unknown[]) => markProcessing(...a),
  markTextReady: (...a: unknown[]) => markReady(...a),
  markTextFailed: (...a: unknown[]) => markFailed(...a),
}));

import { processPdfPage, PdfPageError } from './pdf-page.js';

const TEXT_ID = '11111111-1111-1111-1111-111111111111';

function stageOcrResult(body = 'Egun on') {
  ocrMock.mockResolvedValueOnce({
    language: 'eu',
    pipeline_id: 'stanza-eu',
    width: 800,
    height: 1200,
    body,
    tokens: [
      { idx: 0, surface: 'Egun', is_word: true, candidates: [], bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 } },
    ],
    proposed_phrases: [],
  });
}

describe('processPdfPage', () => {
  beforeEach(() => {
    staged.length = 0;
    updates.length = 0;
    ocrMock.mockReset();
    putMock.mockClear();
    persistTokensMock.mockClear();
    markProcessing.mockClear();
    markReady.mockClear();
    markFailed.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('stores the image, OCRs, updates the chapter, and marks ready on the last page', async () => {
    // selects, in order: text, chapter, total count, done count
    stage([{ id: TEXT_ID, sourceType: 'pdf', status: 'pending', language: 'eu', ownerId: 'u1' }]);
    stage([{ id: 'chap-0' }]);
    stage([{ total: 1 }]);
    stage([{ done: 1 }]);
    stageOcrResult();

    const result = await processPdfPage({
      textId: TEXT_ID,
      idx: 0,
      imageBytes: new Uint8Array([1, 2, 3]),
      mime: 'image/webp',
      width: 800,
      height: 1200,
      bornDigital: { items: [{ str: 'Egun', x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] },
    });

    expect(markProcessing).toHaveBeenCalledWith(TEXT_ID);
    // Image stored under the per-page key.
    expect(putMock).toHaveBeenCalledOnce();
    expect(putMock.mock.calls[0]![0]).toBe(`texts/${TEXT_ID}/pages/0.webp`);
    // OCR called with the born-digital payload.
    expect(ocrMock).toHaveBeenCalledOnce();
    expect(ocrMock.mock.calls[0]![2]).toMatchObject({
      width: 800,
      height: 1200,
      bornDigital: { items: [{ str: 'Egun', x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] },
    });
    // Chapter row updated with body + page image metadata.
    expect(updates[0]).toMatchObject({
      body: 'Egun on',
      pageImageKey: `texts/${TEXT_ID}/pages/0.webp`,
      pageImageMime: 'image/webp',
      pageWidth: 800,
      pageHeight: 1200,
    });
    expect(persistTokensMock).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledWith(TEXT_ID);
    expect(result).toMatchObject({ chapterId: 'chap-0', complete: true });
  });

  it('does not mark ready until every page is processed', async () => {
    stage([{ id: TEXT_ID, sourceType: 'pdf', status: 'processing', language: 'eu', ownerId: 'u1' }]);
    stage([{ id: 'chap-1' }]);
    stage([{ total: 3 }]);
    stage([{ done: 1 }]);
    stageOcrResult();

    const result = await processPdfPage({
      textId: TEXT_ID,
      idx: 1,
      imageBytes: new Uint8Array([1]),
      mime: 'image/webp',
      width: 800,
      height: 1200,
    });

    // Already processing — no re-flip.
    expect(markProcessing).not.toHaveBeenCalled();
    expect(markReady).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
  });

  it('rejects a non-PDF text without touching storage', async () => {
    stage([{ id: TEXT_ID, sourceType: 'txt', status: 'ready', language: 'eu', ownerId: 'u1' }]);

    await expect(
      processPdfPage({
        textId: TEXT_ID,
        idx: 0,
        imageBytes: new Uint8Array([1]),
        mime: 'image/webp',
        width: 10,
        height: 10,
      }),
    ).rejects.toBeInstanceOf(PdfPageError);
    expect(putMock).not.toHaveBeenCalled();
    expect(ocrMock).not.toHaveBeenCalled();
  });

  it('marks the text failed when OCR throws', async () => {
    stage([{ id: TEXT_ID, sourceType: 'pdf', status: 'pending', language: 'eu', ownerId: 'u1' }]);
    stage([{ id: 'chap-0' }]);
    ocrMock.mockRejectedValueOnce(new Error('vision boom'));

    await expect(
      processPdfPage({
        textId: TEXT_ID,
        idx: 0,
        imageBytes: new Uint8Array([1]),
        mime: 'image/webp',
        width: 10,
        height: 10,
      }),
    ).rejects.toThrow('vision boom');
    expect(markFailed).toHaveBeenCalledWith(TEXT_ID, 'vision boom');
  });
});
