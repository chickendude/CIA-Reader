<!--
  Centered modal overlay (T-5.15).

  Renders a backdrop + a centered card. Esc closes; clicking the
  backdrop closes; focus is trapped inside the modal while open and
  restored to the previously-focused element on close. Body scroll is
  locked while the modal is mounted.

  Usage:

      <Modal open={isOpen} onClose={() => isOpen = false} title="Add a text">
        ... body content ...
      </Modal>

  The `title` slot wires up `aria-labelledby`; pass an empty title +
  add your own labelling element with id="modal-title" if you need
  fully custom heading markup.
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { activateFocusTrap, type FocusTrap } from './focus-trap.js';
  import { lockScroll } from './scroll-lock.js';

  interface Props {
    open: boolean;
    onClose: () => void;
    title?: string;
    /** Maximum width of the centered card. Defaults to 540px to match
     *  the CIAR upload modal. */
    width?: number;
    /** Modal body. */
    children?: Snippet;
    /** Optional custom footer (action buttons). */
    footer?: Snippet;
  }

  let { open, onClose, title = '', width = 540, children, footer }: Props =
    $props();

  let dialogEl: HTMLDivElement | null = $state(null);
  let trap: FocusTrap | null = null;
  let releaseScroll: (() => void) | null = null;

  $effect(() => {
    if (!open) {
      trap?.deactivate();
      trap = null;
      releaseScroll?.();
      releaseScroll = null;
      return;
    }
    if (!dialogEl) return;
    trap = activateFocusTrap(dialogEl);
    releaseScroll = lockScroll();
    return () => {
      trap?.deactivate();
      trap = null;
      releaseScroll?.();
      releaseScroll = null;
    };
  });

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }

  onMount(() => {
    // Render-only effect; the $effect block above does the real work.
  });
</script>

{#if open}
  <div
    class="modal-back"
    role="presentation"
    onclick={onBackdropClick}
    onkeydown={onKeydown}
  >
    <div
      bind:this={dialogEl}
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      style:width="{width}px"
    >
      {#if title}
        <div class="modal-h">
          <h3 id="modal-title">{title}</h3>
          <button
            type="button"
            class="close"
            aria-label="Close"
            onclick={onClose}
          >
            ×
          </button>
        </div>
      {/if}
      <div class="modal-body">
        {#if children}{@render children()}{/if}
      </div>
      {#if footer}
        <div class="modal-foot">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-back {
    position: fixed;
    inset: 0;
    background: rgba(20, 16, 10, 0.42);
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    backdrop-filter: blur(6px);
  }
  .modal {
    max-width: 100%;
    background: var(--paper, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    color: var(--ink, var(--color-fg));
  }
  .modal-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--rule, var(--color-border));
  }
  .modal-h h3 {
    font-family: var(--font-serif, var(--font-ui));
    font-weight: 500;
    font-size: 1rem;
    margin: 0;
  }
  .close {
    background: none;
    border: 0;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
  }
  .close:hover {
    color: var(--ink, var(--color-fg));
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 6%,
      transparent
    );
  }
  .modal-body {
    padding: 1.25rem;
  }
  .modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--rule, var(--color-border));
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 90%,
      var(--paper-2, transparent)
    );
  }
</style>
