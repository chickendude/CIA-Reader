<!--
  Sheet overlay (T-5.15).

  Slides up from the bottom on narrow viewports (<960px) and in from
  the right on wide viewports (>=960px). Designed for the reader's
  side-panel (T-5.10), the lang-picker (T-5.11), and any other
  contextual surface that wants to feel like a panel rather than a
  modal dialog.

  Esc and backdrop-click close. Focus is trapped while open. Body
  scroll is locked.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { activateFocusTrap, type FocusTrap } from './focus-trap.js';
  import { lockScroll } from './scroll-lock.js';

  interface Props {
    open: boolean;
    onClose: () => void;
    title?: string;
    /** Sheet width on >=960px. Bottom-sheet on <960px ignores this. */
    width?: number;
    /** Sheet maximum height as a CSS length on <960px (bottom mode). */
    maxHeight?: string;
    children?: Snippet;
  }

  let {
    open,
    onClose,
    title = '',
    width = 380,
    maxHeight = '85dvh',
    children,
  }: Props = $props();

  let panelEl: HTMLDivElement | null = $state(null);
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
    if (!panelEl) return;
    trap = activateFocusTrap(panelEl);
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
</script>

{#if open}
  <div
    class="sheet-back"
    role="presentation"
    onclick={onBackdropClick}
    onkeydown={onKeydown}
  >
    <div
      bind:this={panelEl}
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'sheet-title' : undefined}
      style:--sheet-width="{width}px"
      style:--sheet-max-height={maxHeight}
    >
      {#if title}
        <header class="sheet-h">
          <h3 id="sheet-title">{title}</h3>
          <button
            type="button"
            class="close"
            aria-label="Close"
            onclick={onClose}
          >
            ×
          </button>
        </header>
      {/if}
      <div class="sheet-body">
        {#if children}{@render children()}{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .sheet-back {
    position: fixed;
    inset: 0;
    background: rgba(20, 16, 10, 0.42);
    z-index: 40;
    backdrop-filter: blur(4px);
  }
  .sheet {
    position: absolute;
    background: var(--paper, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    color: var(--ink, var(--color-fg));
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.18);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* Bottom-sheet layout (mobile / narrow). */
  @media (max-width: 959.98px) {
    .sheet {
      left: 0;
      right: 0;
      bottom: 0;
      max-height: var(--sheet-max-height);
      border-radius: 14px 14px 0 0;
      animation: slide-up 220ms cubic-bezier(0.2, 0, 0, 1);
    }
  }
  /* Side-sheet layout (desktop / wide). */
  @media (min-width: 960px) {
    .sheet {
      top: 0;
      right: 0;
      bottom: 0;
      width: var(--sheet-width);
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.18);
      border-radius: 0;
      animation: slide-in-right 220ms cubic-bezier(0.2, 0, 0, 1);
    }
  }
  @keyframes slide-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  @keyframes slide-in-right {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
  .sheet-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--rule, var(--color-border));
  }
  .sheet-h h3 {
    font-family: var(--font-serif, var(--font-ui));
    font-size: 1rem;
    font-weight: 500;
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
  .sheet-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.1rem 1.5rem;
  }

  /* Respect reduced-motion users — no slide animations. */
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }
  }
</style>
