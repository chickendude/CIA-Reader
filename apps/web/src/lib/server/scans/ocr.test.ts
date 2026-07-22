// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ensureScanPageOcrWith, toScanOcrWords } from './ocr.js';
import type { ScanOcrDeps } from './ocr.js';
import type { ScanPage } from '../db/schema.js';

const basePage: ScanPage = {
  id: 'page-1',
  volumeId: 'vol-1',
  pdfPageIndex: 4,
  printedPage: 1,
  imageKey: 'scans/dsal-praharaj/v01/pages/4.jpg',
  imageMime: 'image/jpeg',
  width: 1700,
  height: 2200,
  ocrStatus: 'pending',
  ocrEngine: null,
  ocrText: null,
  ocrWords: null,
  ocrAt: null,
  createdAt: new Date(),
};

function makeDeps(status: ScanPage['ocrStatus']): {
  deps: ScanOcrDeps;
  fetchImage: ReturnType<typeof vi.fn>;
  runOcr: ReturnType<typeof vi.fn>;
  saved: Array<{ status: string; text: string | null }>;
} {
  let page: ScanPage = { ...basePage, ocrStatus: status };
  if (status === 'ok') {
    page = { ...page, ocrText: 'cached text', ocrWords: [{ s: 'cached', x: 0, y: 0, w: 1, h: 1 }] };
  }
  const saved: Array<{ status: string; text: string | null }> = [];
  const fetchImage = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const runOcr = vi.fn(async () => ({
    body: 'kamal कमल',
    words: [{ s: 'kamal', x: 0.1, y: 0.2, w: 0.1, h: 0.03 }],
  }));
  const deps: ScanOcrDeps = {
    loadPage: async () => page,
    saveOcr: async (_id, result) => {
      saved.push({ status: result.status, text: result.text });
      page = {
        ...page,
        ocrStatus: result.status,
        ocrText: result.text,
        ocrWords: result.words,
        ocrEngine: result.engine,
      };
    },
    fetchImage,
    runOcr,
  };
  return { deps, fetchImage, runOcr, saved };
}

describe('ensureScanPageOcrWith', () => {
  it('cache hit: returns the row without touching storage or the NLP service', async () => {
    const { deps, fetchImage, runOcr } = makeDeps('ok');
    const page = await ensureScanPageOcrWith(deps, 'page-1');
    expect(page.ocrText).toBe('cached text');
    expect(fetchImage).not.toHaveBeenCalled();
    expect(runOcr).not.toHaveBeenCalled();
  });

  it('cache miss: runs OCR once and persists text + words', async () => {
    const { deps, runOcr, saved } = makeDeps('pending');
    const page = await ensureScanPageOcrWith(deps, 'page-1');
    expect(runOcr).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([{ status: 'ok', text: 'kamal कमल' }]);
    expect(page.ocrStatus).toBe('ok');
    expect(page.ocrWords).toEqual([{ s: 'kamal', x: 0.1, y: 0.2, w: 0.1, h: 0.03 }]);
  });

  it('a previously failed page is retried on the next open', async () => {
    const { deps, runOcr } = makeDeps('failed');
    const page = await ensureScanPageOcrWith(deps, 'page-1');
    expect(runOcr).toHaveBeenCalledTimes(1);
    expect(page.ocrStatus).toBe('ok');
  });

  it('marks the page failed and rethrows when OCR errors', async () => {
    const { deps, runOcr, saved } = makeDeps('pending');
    runOcr.mockRejectedValueOnce(new Error('vision down'));
    deps.runOcr = runOcr;
    await expect(ensureScanPageOcrWith(deps, 'page-1')).rejects.toThrow('vision down');
    expect(saved).toEqual([{ status: 'failed', text: null }]);
  });

  it('throws for an unknown page id', async () => {
    const { deps } = makeDeps('pending');
    deps.loadPage = async () => null;
    await expect(ensureScanPageOcrWith(deps, 'nope')).rejects.toThrow(/not found/);
  });
});

describe('toScanOcrWords', () => {
  it('keeps boxed word tokens only', () => {
    const words = toScanOcrWords([
      { surface: 'kamal', is_word: true, bbox: { x: 0.1, y: 0.2, w: 0.1, h: 0.03 } },
      { surface: '—', is_word: false, bbox: { x: 0.3, y: 0.2, w: 0.02, h: 0.03 } },
      { surface: 'boxless', is_word: true, bbox: null },
    ]);
    expect(words).toEqual([{ s: 'kamal', x: 0.1, y: 0.2, w: 0.1, h: 0.03 }]);
  });
});
