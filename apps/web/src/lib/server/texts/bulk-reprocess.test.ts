// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const processTextNow = vi.fn();

const reprocessPdfText = vi.fn();
vi.mock('./pdf-page.js', () => ({ reprocessPdfText: (...args: unknown[]) => reprocessPdfText(...args) }));

const rows: Array<Record<string, unknown>> = [];
type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  $dynamic: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => rows),
  $dynamic: vi.fn(() => chain),
};

const fakeDb = {
  select: vi.fn(() => chain),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: {
    texts: {
      id: 'texts.id',
      language: 'texts.language',
      status: 'texts.status',
    },
  },
}));

vi.mock('./in-process-dispatcher.js', () => ({
  processTextNow: (...a: unknown[]) => processTextNow(...a),
}));

const { bulkReprocessTexts, queueReprocessTexts } = await import('./bulk-reprocess.js');

beforeEach(() => {
  rows.length = 0;
  for (const fn of Object.values(chain))
    (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.select.mockClear();
  processTextNow.mockReset();
  processTextNow.mockResolvedValue(0);
});

describe('bulkReprocessTexts', () => {
  it('dispatches every matching text', async () => {
    rows.push({ id: 'tx-1' }, { id: 'tx-2' });
    const r = await bulkReprocessTexts({ language: 'hi' });
    expect(r.dispatched).toBe(2);
    expect(r.textIds).toEqual(['tx-1', 'tx-2']);
    expect(processTextNow).toHaveBeenCalledTimes(2);
  });

  it('limits overlapping batches, skips duplicates and continues after a failure', async () => {
    const first = Promise.withResolvers<number>();
    const second = Promise.withResolvers<number>();
    processTextNow.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const batch = ['a', 'b', 'c'].map((id) => ({ id, sourceType: 'txt' as const }));
    expect(queueReprocessTexts(batch)).toEqual(['a', 'b', 'c']);
    expect(queueReprocessTexts([...batch, { id: 'd', sourceType: 'pdf' }])).toEqual(['d']);
    expect(processTextNow.mock.calls).toEqual([['a'], ['b']]);
    first.reject(new Error('Chapter failed'));
    await vi.waitFor(() => expect(reprocessPdfText).toHaveBeenCalledWith('d'));
    expect(processTextNow.mock.calls).toEqual([['a'], ['b'], ['c']]);
    second.resolve(0);
    await second.promise;
  });

  it('returns 0 when no texts match', async () => {
    const r = await bulkReprocessTexts({});
    expect(r.dispatched).toBe(0);
    expect(processTextNow).not.toHaveBeenCalled();
  });

  it('caps the dispatch count at the requested limit', async () => {
    const r = await bulkReprocessTexts({ limit: 1 });
    // We can't easily assert the SQL `.limit()` arg here, but we
    // verify the call passes through to the chain.
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(r.matched).toBe(0);
  });

  it('filters by language when provided', async () => {
    rows.push({ id: 'tx-1' });
    await bulkReprocessTexts({ language: 'mr' });
    // Single composite WHERE was issued.
    expect(chain.where).toHaveBeenCalledOnce();
  });

  it('filters by status array when provided', async () => {
    rows.push({ id: 'tx-1' });
    await bulkReprocessTexts({ statuses: ['ready', 'failed'] });
    expect(chain.where).toHaveBeenCalledOnce();
  });

  it('swallows dispatcher errors without rejecting the bulk call', async () => {
    rows.push({ id: 'tx-explode' });
    processTextNow.mockRejectedValueOnce(new Error('dispatcher down'));
    const r = await bulkReprocessTexts({});
    expect(r.dispatched).toBe(1);
  });
});
