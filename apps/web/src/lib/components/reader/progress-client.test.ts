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
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
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
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
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
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const w = new ProgressWriter('text-1');
    w.schedule({ chapterIdx: 1, tokenIdx: 5, pctRead: 5 });
    await w.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('swallows network errors so the reader keeps working', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
    vi.stubGlobal('fetch', fetchMock);

    const w = new ProgressWriter('text-1');
    w.schedule({ chapterIdx: 1, tokenIdx: 5, pctRead: 5 });
    await expect(w.flush()).resolves.toBeUndefined();
  });
});
