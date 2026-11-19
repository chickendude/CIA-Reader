import { createContext } from 'svelte';
import { readonly, writable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info';

export type Toast = {
  /** Stable id for keying + programmatic dismiss. */
  id: string;
  kind: ToastKind;
  message: string;
  progress?: { value?: number; max: number; label: string };
  /** ms before auto-dismiss; `null` means sticky. */
  duration: number | null;
};

export type PushToastInput = {
  kind?: ToastKind;
  message: string;
  progress?: Toast['progress'];
  /** Pass `null` to keep the toast visible until dismissed. */
  duration?: number | null;
};

export type ToastStore = ReturnType<typeof createToastStore>;

export const [getToastStore, setToastStore] = createContext<ToastStore>();

export function createToastStore() {
  const inner = writable<Toast[]>([]);
  let counter = 0;

  function pushToast(input: PushToastInput): string {
    counter += 1;
    const id = `toast-${counter}-${Date.now()}`;
    inner.update((list) => [...list, makeToast(id, input)]);
    return id;
  }

  function updateToast(id: string, input: PushToastInput): boolean {
    let found = false;
    inner.update((list) => list.map((toast) => {
      if (toast.id !== id) return toast;
      found = true;
      return makeToast(id, input);
    }));
    return found;
  }

  function dismissToast(id: string): void {
    inner.update((list) => list.filter((toast) => toast.id !== id));
  }

  return { toasts: readonly(inner), pushToast, updateToast, dismissToast };
}

function makeToast(id: string, {
  kind = 'info', message, progress, duration = kind === 'success' ? 2000 : 5000,
}: PushToastInput): Toast {
  return { id, kind, message, duration, progress };
}
