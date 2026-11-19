// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createToastStore } from './toast-store.js';

describe('pushToast', () => {
  it('appends a toast with the supplied fields and returns the id', () => {
    const { pushToast, toasts } = createToastStore();
    const id = pushToast({ kind: 'success', message: 'Saved' });
    const list = get(toasts);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(id);
    expect(list[0]!.kind).toBe('success');
    expect(list[0]!.message).toBe('Saved');
    expect(list[0]!.duration).toBe(2000);
  });

  it('defaults `kind` to "info" when omitted', () => {
    const { pushToast, toasts } = createToastStore();
    pushToast({ message: 'Heads up' });
    expect(get(toasts)[0]!.kind).toBe('info');
    expect(get(toasts)[0]!.duration).toBe(5000);
  });

  it('honors a custom `duration`', () => {
    const { pushToast, toasts } = createToastStore();
    pushToast({ message: 'quick', duration: 1500 });
    expect(get(toasts)[0]!.duration).toBe(1500);
  });

  it('keeps the toast sticky when `duration` is null', () => {
    const { pushToast, toasts } = createToastStore();
    pushToast({ message: 'sticky', duration: null });
    expect(get(toasts)[0]!.duration).toBeNull();
  });

  it('returns unique ids across rapid calls', () => {
    const { pushToast, toasts } = createToastStore();
    const a = pushToast({ message: 'a' });
    const b = pushToast({ message: 'b' });
    const c = pushToast({ message: 'c' });
    expect(new Set([a, b, c]).size).toBe(3);
    expect(get(toasts)).toHaveLength(3);
  });
});

describe('dismissToast', () => {
  it('removes the targeted toast and leaves the rest', () => {
    const { pushToast, dismissToast, toasts } = createToastStore();
    const a = pushToast({ message: 'a' });
    const b = pushToast({ message: 'b' });
    dismissToast(a);
    const list = get(toasts);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(b);
  });

  it('is a no-op when the id is unknown', () => {
    const { pushToast, dismissToast, toasts } = createToastStore();
    pushToast({ message: 'still here' });
    dismissToast('does-not-exist');
    expect(get(toasts)).toHaveLength(1);
  });
});

it('keeps notifications scoped to the store that created them', () => {
  const first = createToastStore();
  const second = createToastStore();
  const id = first.pushToast({ message: 'First reader' });

  expect(get(second.toasts)).toEqual([]);
  expect(second.updateToast(id, { message: 'Second reader' })).toBe(false);
  second.dismissToast(id);
  expect(get(first.toasts)[0]?.message).toBe('First reader');
});
