<!--
  Reader chapter selector (chrome shared by all three reader modes).

  Renders the current chapter title flanked by prev/next chapter
  arrows, with a caret that opens a dropdown table-of-contents listing
  every chapter + its word count. Plain text — no pill chrome. The
  entry list + current index come from `buildReaderToc` (reader-toc.ts)
  so this component is layout-agnostic (in-text chapters and chapter-
  book collections look identical here). Navigation is via real
  `<a href>`s (SvelteKit intercepts the click) so each entry preserves
  the active reader `mode` and is middle-click / SSR friendly.

  Dropdown open/close + outside-click + Escape mirror the AppShell
  language picker. Arrow keys move focus between rows and, while the
  menu is open, are kept from bubbling to the window-level ←/→
  page-flip handler.
-->
<script lang="ts">
  import { tick } from 'svelte';

  import type { ReaderTocEntry } from './reader-toc.js';

  let {
    entries,
    currentIndex,
    nextLocked = false,
  }: {
    entries: ReaderTocEntry[];
    currentIndex: number;
    /** Course-gating on the immediate next sibling (collections only).
     *  The next arrow then routes through `?skipLock=1` + shows a hint,
     *  mirroring the previous cross-text strip. TOC jumps stay free. */
    nextLocked?: boolean;
  } = $props();

  const current = $derived(entries[currentIndex] ?? entries[0] ?? null);
  const hasMultiple = $derived(entries.length > 1);
  const prev = $derived(currentIndex > 0 ? entries[currentIndex - 1] : null);
  const next = $derived(
    currentIndex >= 0 && currentIndex < entries.length - 1
      ? entries[currentIndex + 1]
      : null,
  );
  const nextHref = $derived(
    next ? (nextLocked ? `${next.href}&skipLock=1` : next.href) : null,
  );

  let open = $state(false);
  let menuEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);

  function close() {
    open = false;
  }

  // Close on outside-click / Escape while open (mirrors AppShell).
  $effect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('.chapter-nav-menu')) return;
      if (t.closest('.chapter-nav-trigger')) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close();
        triggerEl?.focus();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  // On open, focus + scroll the current row into view so a long TOC
  // lands on "you are here" rather than the top.
  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      const active =
        menuEl?.querySelector<HTMLElement>('[aria-checked="true"]') ??
        menuEl?.querySelector<HTMLElement>('[role="menuitemradio"]');
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest' });
      }
      active?.focus();
    });
  });

  function rowEls(): HTMLElement[] {
    return Array.from(
      menuEl?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
    );
  }

  function onMenuKeydown(e: KeyboardEvent) {
    // Shield the window-level page-flip (←/→) + Esc handlers while the
    // reader is driving the menu with the keyboard.
    if (
      ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
        e.key,
      )
    ) {
      e.stopPropagation();
    }
    const rows = rowEls();
    if (rows.length === 0) return;
    const idx = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (rows[Math.min(rows.length - 1, idx + 1)] ?? rows[0])?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (rows[Math.max(0, idx - 1)] ?? rows[rows.length - 1])?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      rows[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      rows[rows.length - 1]?.focus();
    }
  }
</script>

<div class="chapter-nav" data-testid="chapter-nav">
  {#if hasMultiple}
    {#if prev}
      <a
        class="chapter-nav-arrow"
        href={prev.href}
        aria-label="Previous chapter"
        title="Previous chapter"
        onclick={close}>‹</a
      >
    {:else}
      <span class="chapter-nav-arrow is-disabled" aria-hidden="true">‹</span>
    {/if}

    <button
      type="button"
      class="chapter-nav-trigger"
      bind:this={triggerEl}
      aria-haspopup="menu"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <span class="chapter-nav-title" dir="auto">{current?.title ?? ''}</span>
      <span class="chapter-nav-caret" aria-hidden="true">▾</span>
    </button>

    {#if nextHref}
      <a
        class="chapter-nav-arrow"
        class:is-locked={nextLocked}
        href={nextHref}
        aria-label={nextLocked
          ? 'Next chapter (locked — finish this one to advance)'
          : 'Next chapter'}
        title={nextLocked
          ? 'Next chapter (locked — finish this one to advance)'
          : 'Next chapter'}
        onclick={close}>›</a
      >
    {:else}
      <span class="chapter-nav-arrow is-disabled" aria-hidden="true">›</span>
    {/if}

    {#if open}
      <div
        class="chapter-nav-menu"
        role="menu"
        tabindex="-1"
        aria-label="Chapters"
        bind:this={menuEl}
        onkeydown={onMenuKeydown}
      >
        <ul class="chapter-nav-list">
          {#each entries as entry (entry.key)}
            <li>
              <a
                class="chapter-nav-row"
                role="menuitemradio"
                aria-checked={entry.isCurrent}
                data-active={entry.isCurrent ? '1' : '0'}
                tabindex="-1"
                href={entry.href}
                onclick={close}
              >
                <span class="chapter-nav-num" aria-hidden="true">{entry.number}</span>
                <span class="chapter-nav-row-text">
                  <span class="chapter-nav-row-title" dir="auto">{entry.title}</span>
                  <span class="chapter-nav-row-meta"
                    >{entry.words.toLocaleString()} words</span
                  >
                </span>
                {#if entry.isCurrent}
                  <span class="chapter-nav-row-current" aria-label="Current">●</span>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {:else if current}
    <span class="chapter-nav-title chapter-nav-title-static" dir="auto"
      >{current.title}</span
    >
  {/if}
</div>

<style>
  .chapter-nav {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 0;
  }

  /* Plain chevrons — no pill chrome. Full-contrast ink so they read
     on the paper surface in both themes. */
  .chapter-nav-arrow {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--ink-2, var(--color-fg));
    text-decoration: none;
    font-size: 1.25rem;
    line-height: 1;
    transition:
      background 150ms ease,
      color 150ms ease;
  }
  .chapter-nav-arrow:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 7%, transparent);
    color: var(--ink, var(--color-fg));
  }
  .chapter-nav-arrow.is-disabled {
    opacity: 0.25;
    cursor: default;
  }
  .chapter-nav-arrow.is-locked {
    opacity: 0.55;
  }

  .chapter-nav-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: min(60vw, 22rem);
    padding: 0.25rem 0.4rem;
    border: 0;
    background: transparent;
    color: var(--ink, var(--color-fg));
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    transition: background 150ms ease;
  }
  .chapter-nav-trigger:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
  }
  .chapter-nav-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .chapter-nav-title-static {
    color: var(--ink, var(--color-fg));
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    font-weight: 500;
    max-width: min(70vw, 26rem);
  }
  .chapter-nav-caret {
    flex-shrink: 0;
    font-size: 0.7rem;
    color: var(--ink-3, var(--color-fg-muted));
  }

  /* Dropdown surface — mirrors the AppShell language picker. */
  .chapter-nav-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    min-width: 260px;
    max-width: min(92vw, 360px);
    max-height: min(70dvh, 480px);
    overflow-y: auto;
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    padding: 0.5rem;
  }
  .chapter-nav-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .chapter-nav-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--ink, var(--color-fg));
    text-decoration: none;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 150ms ease,
      background 150ms ease;
  }
  .chapter-nav-row:hover,
  .chapter-nav-row:focus-visible {
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 50%,
      var(--card-edge, var(--color-border))
    );
    outline: none;
  }
  .chapter-nav-row[data-active='1'] {
    border-color: var(--accent, var(--color-accent));
    background: var(--accent-soft, var(--color-accent));
  }
  .chapter-nav-num {
    flex-shrink: 0;
    min-width: 1.6rem;
    text-align: right;
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
    font-size: 0.8rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .chapter-nav-row-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1;
    min-width: 0;
  }
  .chapter-nav-row-title {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 0.95rem;
    color: var(--ink, var(--color-fg));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chapter-nav-row-meta {
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.72rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .chapter-nav-row-current {
    flex-shrink: 0;
    color: var(--accent-ink, var(--color-accent));
    font-size: 0.7rem;
  }
</style>
