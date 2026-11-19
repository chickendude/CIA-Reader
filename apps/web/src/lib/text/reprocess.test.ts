// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createToastStore } from '$lib/components/toast/toast-store.js';
import { reprocessWithProgress, reprocessWithToast } from './reprocess.js';

function respondWith(chunks: string[]) {
  const encoder = new TextEncoder();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reprocessWithProgress', () => {
  it('reads updates split across network chunks and returns the confirmed result', async () => {
    respondWith([
      '{"type":"progress","completed":0,',
      '"total":1}\n{"type":"progress","completed":1,"total":1}\n{"type":"complete","tokensWritten":42,"wordsParsed":19}\n',
    ]);
    const progress = vi.fn();
    expect(await reprocessWithProgress('book', progress)).toBe(19);
    expect(progress.mock.calls).toEqual([[0, 1], [1, 1]]);
  });

  it('requires confirmation even after every chapter has been checked', async () => {
    respondWith(['{"type":"progress","completed":3,"total":3}\n']);
    await expect(reprocessWithProgress('book', vi.fn())).rejects.toThrow(/Connection closed/);
  });

  it('surfaces a processing failure after progress has started', async () => {
    respondWith(['{"type":"progress","completed":0,"total":1}\n{"type":"error","message":"Book reprocessing failed."}\n']);
    await expect(reprocessWithProgress('book', vi.fn())).rejects.toThrow('Book reprocessing failed.');
  });
});

describe('reprocessWithToast', () => {
  const book = { id: 'book', title: 'Test book', sourceType: 'pdf' };

  it('updates one notification through progress and completion', async () => {
    const store = createToastStore();
    respondWith(['{"type":"progress","completed":1,"total":3}\n{"type":"complete","tokensWritten":5,"wordsParsed":2}\n']);
    const changes: { id: string; message: string }[] = [];
    const unsubscribe = store.toasts.subscribe((list) => {
      expect(list.length).toBeLessThanOrEqual(1);
      if (list[0]) changes.push(list[0]);
    });
    try {
      expect(await reprocessWithToast(book, store)).toBe(true);
      expect(new Set(changes.map((toast) => toast.id)).size).toBe(1);
      expect(changes[1]).toMatchObject({
        message: 'Parsing page 2 of 3…', duration: null,
        progress: { value: 1, max: 3, label: 'Pages parsed' },
      });
      expect(get(store.toasts)[0]).toMatchObject({
        message: 'Reprocessed Test book. Parsed 2 words.', kind: 'success', duration: 2000, progress: undefined,
      });
    } finally {
      unsubscribe();
    }
  });

  it('removes the progress bar when processing fails', async () => {
    const store = createToastStore();
    respondWith(['{"type":"error","message":"Book reprocessing failed."}\n']);
    expect(await reprocessWithToast(book, store)).toBe(false);
    expect(get(store.toasts)).toHaveLength(1);
    expect(get(store.toasts)[0]).toMatchObject({ kind: 'error', progress: undefined });
  });
});
