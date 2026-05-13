// @vitest-environment node
/**
 * Unit tests for the toast store.
 *
 * The store is a thin wrapper around `svelte/store#writable` exposing
 * a push/dismiss/clear API. We exercise the subscribe contract +
 * defaulting rules without mounting any Svelte component — the
 * visual behaviour is component territory and tested via the Svelte
 * UI in browser e2e if it ever becomes flaky.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import {
  clearToasts,
  dismissToast,
  pushToast,
  toasts,
} from './toast-store.js';

afterEach(() => {
  clearToasts();
});

describe('pushToast', () => {
  it('appends a toast with the supplied fields and returns the id', () => {
    const id = pushToast({ kind: 'success', message: 'Saved' });
    const list = get(toasts);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(id);
    expect(list[0]!.kind).toBe('success');
    expect(list[0]!.message).toBe('Saved');
    expect(list[0]!.duration).toBe(5000);
  });

  it('defaults `kind` to "info" when omitted', () => {
    pushToast({ message: 'Heads up' });
    expect(get(toasts)[0]!.kind).toBe('info');
  });

  it('honors a custom `duration`', () => {
    pushToast({ message: 'quick', duration: 1500 });
    expect(get(toasts)[0]!.duration).toBe(1500);
  });

  it('keeps the toast sticky when `duration` is null', () => {
    pushToast({ message: 'sticky', duration: null });
    expect(get(toasts)[0]!.duration).toBeNull();
  });

  it('returns unique ids across rapid calls', () => {
    const a = pushToast({ message: 'a' });
    const b = pushToast({ message: 'b' });
    const c = pushToast({ message: 'c' });
    expect(new Set([a, b, c]).size).toBe(3);
    expect(get(toasts)).toHaveLength(3);
  });
});

describe('dismissToast', () => {
  it('removes the targeted toast and leaves the rest', () => {
    const a = pushToast({ message: 'a' });
    const b = pushToast({ message: 'b' });
    dismissToast(a);
    const list = get(toasts);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(b);
  });

  it('is a no-op when the id is unknown', () => {
    pushToast({ message: 'still here' });
    dismissToast('does-not-exist');
    expect(get(toasts)).toHaveLength(1);
  });
});

describe('clearToasts', () => {
  it('empties the store', () => {
    pushToast({ message: 'a' });
    pushToast({ message: 'b' });
    clearToasts();
    expect(get(toasts)).toEqual([]);
  });
});
