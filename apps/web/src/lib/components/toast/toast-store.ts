/**
 * App-wide toast store.
 *
 * Anything that wants to surface a transient notification calls
 * `pushToast({ kind, message, duration? })`. A single `<ToastHost />`
 * in the root layout subscribes to this store and renders the active
 * stack — callers never need to mount anything component-side.
 *
 * The store is a plain Svelte `writable` so it works equally well
 * inside `.svelte` components (`$store` syntax) and `.ts` modules
 * (the imperative API below). Toasts auto-dismiss after `duration`
 * ms; pass `duration: null` for a sticky toast the user has to
 * close by hand.
 */
import { writable, type Readable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info';

export type Toast = {
  /** Stable id for keying + programmatic dismiss. */
  id: string;
  kind: ToastKind;
  message: string;
  /** ms before auto-dismiss; `null` means sticky. */
  duration: number | null;
};

const inner = writable<Toast[]>([]);

/**
 * Read-only view of the active toasts. Public consumers shouldn't
 * mutate the list directly — they go through the helpers below so the
 * store stays the single mutation point.
 */
export const toasts: Readable<Toast[]> = { subscribe: inner.subscribe };

let counter = 0;

export type PushToastInput = {
  kind?: ToastKind;
  message: string;
  /** Defaults to 5000ms. Pass `null` to make the toast sticky. */
  duration?: number | null;
};

/**
 * Append a toast to the stack and return its id. The id can be
 * passed to `dismissToast` to remove it programmatically (useful
 * when a long-running operation wants to clear a "loading…" toast
 * once it succeeds).
 */
export function pushToast(input: PushToastInput): string {
  counter += 1;
  const id = `toast-${counter}-${Date.now()}`;
  const toast: Toast = {
    id,
    kind: input.kind ?? 'info',
    message: input.message,
    duration: input.duration === undefined ? 5000 : input.duration,
  };
  inner.update((list) => [...list, toast]);
  return id;
}

export function dismissToast(id: string): void {
  inner.update((list) => list.filter((t) => t.id !== id));
}

export function clearToasts(): void {
  inner.set([]);
}
