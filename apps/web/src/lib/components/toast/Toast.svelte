<!--
  Single toast row. Rendered by `ToastHost`; not meant to be used
  directly elsewhere — pass through `pushToast()` instead so the
  store stays the single source of truth.

  The component owns its own auto-dismiss timer keyed off the
  toast's `duration`. A `duration` of `null` makes the toast sticky;
  the user can still close it via the × button.
-->
<script lang="ts">
  import type { Toast as ToastType } from './toast-store.js';
  import { dismissToast } from './toast-store.js';

  let { toast }: { toast: ToastType } = $props();

  // Auto-dismiss after `duration` ms. We re-arm the timer if the
  // toast object identity changes (defensive — `ToastHost` keys
  // children by id so this shouldn't normally happen, but the
  // teardown still cleans up correctly).
  $effect(() => {
    if (toast.duration == null) return;
    const t = window.setTimeout(() => dismissToast(toast.id), toast.duration);
    return () => window.clearTimeout(t);
  });
</script>

<div
  class="toast"
  class:success={toast.kind === 'success'}
  class:error={toast.kind === 'error'}
  class:info={toast.kind === 'info'}
  role={toast.kind === 'error' ? 'alert' : 'status'}
  aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
>
  <span class="msg">{toast.message}</span>
  <button
    type="button"
    class="close"
    aria-label="Dismiss notification"
    onclick={() => dismissToast(toast.id)}
  >
    ×
  </button>
</div>

<style>
  /*
   * Surface + stripe design.
   *
   * Solid `--color-surface-1` background and `--color-fg` text — both
   * read from the active theme so the toast is legible on light,
   * sepia, and dark with WCAG AA contrast (no accent-on-transparent
   * for text — see the project's UI contrast rule). The toast's
   * "kind" is signalled by a 4px left stripe coloured with the
   * semantic token for that kind; the message itself never sits on a
   * tinted background, so contrast is always toast-bg-vs-fg.
   */
  .toast {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 16rem;
    max-width: 28rem;
    padding: 0.65rem 0.85rem;
    border-radius: 8px;
    background: var(--color-surface-1);
    color: var(--color-fg);
    border: 1px solid var(--color-border);
    border-left: 4px solid var(--color-fg-subtle);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.15);
    font-size: 0.9rem;
    line-height: 1.4;
    animation: toast-in 180ms ease-out;
  }
  .toast.success {
    border-left-color: var(--color-success);
  }
  .toast.error {
    border-left-color: var(--color-danger);
  }
  .toast.info {
    border-left-color: var(--color-accent);
  }
  .msg {
    flex: 1;
  }
  .close {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: transparent;
    color: currentColor;
    border-radius: 4px;
    font-size: 1.2rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0.65;
  }
  .close:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.06);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
