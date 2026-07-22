// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { printedPageFor, runScanIngest } from './ingest.js';
import type { IngestDeps, IngestOptions, IngestRepo } from './ingest.js';

/** Minimal valid JPEG (SOI + SOF0) so the dimension check passes. */
const JPEG = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x00,
  0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
]);

const OPTS: IngestOptions = {
  dictionarySlug: 'dsal-praharaj',
  volumeNumber: 1,
  pageOffset: -4,
  printedStart: 1,
  printedEnd: 100,
  sourceUrl: 'https://archive.org/details/example',
  dpi: 200,
};

type PageRow = { pdfPageIndex: number; printedPage: number | null; imageKey: string };

function makeDeps(existing: number[] = []): {
  deps: IngestDeps;
  pages: PageRow[];
  stored: string[];
  volumeUpserts: number;
} {
  const state = { pages: [] as PageRow[], stored: [] as string[], volumeUpserts: 0 };
  const present = new Set(existing);
  const repo: IngestRepo = {
    async upsertVolume() {
      state.volumeUpserts += 1;
      return { id: 'vol-1', pageCount: 0 };
    },
    async hasPage(_volumeId, idx) {
      return present.has(idx);
    },
    async upsertPage(input) {
      state.pages.push({
        pdfPageIndex: input.pdfPageIndex,
        printedPage: input.printedPage,
        imageKey: input.imageKey,
      });
    },
  };
  const deps: IngestDeps = {
    pageCount: async () => 8,
    rasterizePage: async () => JPEG,
    storeImage: async (key) => {
      state.stored.push(key);
    },
    imageKeyFor: (idx, mime) => `scans/dsal-praharaj/v01/pages/${idx}.${mime === 'image/jpeg' ? 'jpg' : 'bin'}`,
    repo,
  };
  return { deps, ...state };
}

describe('printedPageFor', () => {
  it('applies the offset within the calibrated range', () => {
    expect(printedPageFor(5, OPTS)).toBe(1);
    expect(printedPageFor(10, OPTS)).toBe(6);
  });

  it('returns null for front matter and out-of-range pages', () => {
    expect(printedPageFor(0, OPTS)).toBeNull(); // printed -4
    expect(printedPageFor(4, OPTS)).toBeNull(); // printed 0
    expect(printedPageFor(200, OPTS)).toBeNull(); // beyond printedEnd
  });

  it('works without an explicit range', () => {
    expect(printedPageFor(0, { pageOffset: 1 })).toBe(1);
    expect(printedPageFor(0, { pageOffset: 0 })).toBeNull(); // printed 0 is not a page
  });
});

describe('runScanIngest', () => {
  it('rasterizes, stores, and records every page with printed-page mapping', async () => {
    const { deps, pages, stored } = makeDeps();
    const summary = await runScanIngest(OPTS, deps);
    expect(summary).toEqual({ pages: 8, written: 8, skipped: 0 });
    expect(stored).toHaveLength(8);
    expect(pages[0]).toEqual({
      pdfPageIndex: 0,
      printedPage: null,
      imageKey: 'scans/dsal-praharaj/v01/pages/0.jpg',
    });
    expect(pages[5]!.printedPage).toBe(1);
  });

  it('resumes: skips pages that already have rows', async () => {
    const { deps, pages } = makeDeps([0, 1, 2]);
    const summary = await runScanIngest(OPTS, deps);
    expect(summary).toEqual({ pages: 8, written: 5, skipped: 3 });
    expect(pages.map((p) => p.pdfPageIndex)).toEqual([3, 4, 5, 6, 7]);
  });

  it('re-processes everything under force', async () => {
    const { deps } = makeDeps([0, 1, 2]);
    const summary = await runScanIngest({ ...OPTS, force: true }, deps);
    expect(summary.written).toBe(8);
  });

  it('fails loudly on an unparseable rasterizer output', async () => {
    const { deps } = makeDeps();
    deps.rasterizePage = async () => new Uint8Array([1, 2, 3]);
    await expect(runScanIngest(OPTS, deps)).rejects.toThrow(/unparseable JPEG/);
  });

  it('rejects a zero-page PDF', async () => {
    const { deps } = makeDeps();
    deps.pageCount = async () => 0;
    await expect(runScanIngest(OPTS, deps)).rejects.toThrow(/zero pages/);
  });
});
