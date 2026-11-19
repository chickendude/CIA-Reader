import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressWriter } from './progress-client.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ProgressWriter', () => {
  it('debounces repeated schedule() calls into a single PATCH', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const w = new ProgressWriter('text-1');
    w.schedule({ chapterIdx: 0, tokenIdx: 1, pctRead: 1 });
    w.schedule({ chapterIdx: 0, tokenIdx: 2, pctRead: 2 });
    w.schedule({ chapterIdx: 0, tokenIdx: 3, pctRead: 3 });

    // Nothing flushed yet.
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({ chapterIdx: 0, tokenIdx: 3, pctRead: 3 });
  });

  it('suppresses a flush when nothing has changed since the previous send', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const w = new ProgressWriter('text-1');
    w.schedule({ chapterIdx: 0, tokenIdx: 0, pctRead: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    w.schedule({ chapterIdx: 0, tokenIdx: 0, pctRead: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('flush() bypasses the debounce timer', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const w = new ProgressWriter('text-1');
    w.schedule({ chapterIdx: 1, tokenIdx: 5, pctRead: 5 });
    await w.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can flush through the browser keepalive path for refresh/pagehide', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const w = new ProgressWriter('text-1');
    w.schedule({ chapterIdx: 2, tokenIdx: 25, pctRead: 50 });
    await w.flush();

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[1].keepalive).toBe(true);
  });

  it('keeps a debounced save alive if the tab is discarded during the request', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', send);
    const writer = new ProgressWriter('text-1');
    writer.schedule({ chapterIdx: 4, tokenIdx: 7, pctRead: 12 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(send.mock.calls[0]?.[1]?.keepalive).toBe(true);
  });

  it('retains a failed position until a save succeeds', async () => {
    const send = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response());
    vi.stubGlobal('fetch', send);
    const writer = new ProgressWriter('text-1');
    const anchor = { chapterIdx: 1, tokenIdx: 50, pctRead: 12 };
    writer.schedule(anchor);
    await writer.flush();
    await writer.flush();
    await writer.flush();
    writer.schedule(anchor);
    await writer.flush();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.every(([, init]) => init?.body === JSON.stringify(anchor))).toBe(true);
  });

  it('saves a newer backward turn after a slow request finishes', async () => {
    let finish!: (response: Response) => void;
    const send = vi.fn<typeof fetch>()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValue(new Response());
    vi.stubGlobal('fetch', send);
    const writer = new ProgressWriter('text-1');
    writer.schedule({ chapterIdx: 1, tokenIdx: 90, pctRead: 20 });
    const first = writer.flush();
    const latest = { chapterIdx: 1, tokenIdx: 45, pctRead: 10 };
    writer.schedule(latest);
    const second = writer.flush();
    expect(send).toHaveBeenCalledTimes(1);
    finish(new Response(null, { status: 503 }));
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(latest));
  });

  it('saves a return to a previous word after an intervening response was lost', async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response())
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValue(new Response());
    vi.stubGlobal('fetch', send);
    const writer = new ProgressWriter('text-1');
    const original = { chapterIdx: 1, tokenIdx: 40, pctRead: 10 };
    writer.schedule(original);
    await writer.flush();
    writer.schedule({ chapterIdx: 1, tokenIdx: 80, pctRead: 20 });
    await writer.flush();
    writer.schedule(original);
    await writer.flush();
    expect(send.mock.calls[2]?.[1]?.body).toBe(JSON.stringify(original));
  });

  it('swallows network errors so the reader keeps working', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
    vi.stubGlobal('fetch', fetchMock);

    const w = new ProgressWriter('text-1');
    w.schedule({ chapterIdx: 1, tokenIdx: 5, pctRead: 5 });
    await expect(w.flush()).resolves.toBeUndefined();
  });
});
