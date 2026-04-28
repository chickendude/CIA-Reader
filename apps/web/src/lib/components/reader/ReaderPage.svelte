<!--
  Page-mode reader (T-5.1, token-aware in T-5.2, chrome polish in T-5.9,
  no-scroll pagination in T-5.23).

  The chapter renders into a fixed-height viewport that hides
  overflow. Each "page" is one viewport-height slice of the chapter,
  positioned via translateY. Off-screen content is still in the DOM
  (so screen readers + Cmd-F still find it) — just clipped.

  Side arrows + keyboard ←/→ step through pages within a chapter and
  spill over into the prev/next chapter at the boundaries. The
  bottom progress foot reports both the page-in-chapter and the
  overall chapter position.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  import ChapterBody from './ChapterBody.svelte';
  import { clampPage, pageCountFor, pageOffset } from './paginate.js';
  import type { ChapterView } from './types.js';

  let {
    chapters,
    chapterIdx,
    textId,
    showRomanization = false,
    isOwner = false,
  }: {
    chapters: ChapterView[];
    chapterIdx: number;
    textId: string;
    showRomanization?: boolean;
    isOwner?: boolean;
  } = $props();

  const current = $derived(
    chapters[Math.max(0, Math.min(chapterIdx, chapters.length - 1))],
  );
  const hasPrevChapter = $derived(chapterIdx > 0);
  const hasNextChapter = $derived(chapterIdx < chapters.length - 1);

  // Pagination state. Recomputed on resize / chapter change /
  // showRomanization toggle (which changes line-height).
  let viewportEl: HTMLDivElement | null = $state(null);
  let contentEl: HTMLDivElement | null = $state(null);
  let viewportH = $state(0);
  let contentH = $state(0);
  let pageInChapter = $state(0);

  const pageCount = $derived(pageCountFor(contentH, viewportH));
  const offset = $derived(pageOffset(pageInChapter, viewportH));

  // Reset to the first page whenever the chapter changes — the user
  // shouldn't see "stuck" mid-page state when they navigate.
  $effect(() => {
    void chapterIdx;
    pageInChapter = 0;
  });

  // Keep pageInChapter in range when pageCount shrinks (e.g. window
  // grows so the chapter fits in fewer pages).
  $effect(() => {
    pageInChapter = clampPage(pageInChapter, pageCount);
  });

  const hasPrevPage = $derived(pageInChapter > 0);
  const hasNextPage = $derived(pageInChapter < pageCount - 1);
  const hasPrev = $derived(hasPrevPage || hasPrevChapter);
  const hasNext = $derived(hasNextPage || hasNextChapter);

  // Overall progress — fraction of the whole text the user has read.
  // Fractional pages-in-chapter give a smoother percentage than just
  // counting whole chapters.
  const progressPct = $derived(
    chapters.length > 0
      ? Math.round(
          ((chapterIdx + (pageCount > 0 ? (pageInChapter + 1) / pageCount : 0)) /
            chapters.length) *
            100,
        )
      : 0,
  );

  function go(nextIdx: number, opts: { lastPage?: boolean } = {}) {
    void goto(`/reader/${textId}?mode=page&chapter=${nextIdx}`, {
      keepFocus: true,
    });
    // The new chapter mounts with pageInChapter=0; if we're stepping
    // backwards into the previous chapter, jump to its last page once
    // pagination remeasures. Tracked via a flag so the resize $effect
    // can apply it.
    pendingJumpToLast = opts.lastPage === true;
  }

  let pendingJumpToLast = $state(false);
  $effect(() => {
    if (!pendingJumpToLast) return;
    if (pageCount > 0) {
      pageInChapter = pageCount - 1;
      pendingJumpToLast = false;
    }
  });

  function nextPage() {
    if (hasNextPage) {
      pageInChapter += 1;
    } else if (hasNextChapter) {
      go(chapterIdx + 1);
    }
  }
  function prevPage() {
    if (hasPrevPage) {
      pageInChapter -= 1;
    } else if (hasPrevChapter) {
      go(chapterIdx - 1, { lastPage: true });
    }
  }

  // T-5.7: ←/→ flip pages. Skip when typing in a form / textarea so
  // the popup's add-translation form keeps Enter/Esc behavior.
  function isTypingInsideElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingInsideElement(e.target)) return;
    if (document.querySelector('[data-testid="word-popup"]')) return;
    if (e.key === 'ArrowLeft' && hasPrev) {
      e.preventDefault();
      prevPage();
    } else if (e.key === 'ArrowRight' && hasNext) {
      e.preventDefault();
      nextPage();
    }
  }

  // Measure on mount + on resize / content change. ResizeObserver on
  // both the viewport (window resize, font-size change) and the
  // content (chapter toggle, romanization toggle changing line
  // height) keeps pageCount honest.
  onMount(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (viewportEl) viewportH = viewportEl.clientHeight;
      if (contentEl) contentH = contentEl.scrollHeight;
    });
    if (viewportEl) ro.observe(viewportEl);
    if (contentEl) ro.observe(contentEl);
    // Seed initial measurements before the observer fires.
    if (viewportEl) viewportH = viewportEl.clientHeight;
    if (contentEl) contentH = contentEl.scrollHeight;
    return () => ro.disconnect();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="reader-page-wrap" data-mode="page">
  <button
    type="button"
    class="page-arrow page-arrow-l"
    aria-label="Previous page"
    disabled={!hasPrev}
    onclick={prevPage}
  >
    ‹
  </button>

  <div class="reader-page-viewport" bind:this={viewportEl}>
    <div
      class="reader-page-content"
      bind:this={contentEl}
      style:transform="translateY(-{offset}px)"
    >
      {#if current}
        <header class="chapter-h">
          {current.title ?? `Chapter ${current.idx + 1}`}
          <span class="roman">
            Chapter {current.idx + 1} of {chapters.length}
            · {current.tokenCount.toLocaleString()} tokens
          </span>
        </header>
        <article>
          <ChapterBody chapter={current} {showRomanization} {isOwner} />
        </article>
      {/if}
    </div>
  </div>

  <button
    type="button"
    class="page-arrow page-arrow-r"
    aria-label="Next page"
    disabled={!hasNext}
    onclick={nextPage}
  >
    ›
  </button>
</div>

<footer class="reader-foot" aria-label="Chapter progress">
  <div class="reader-foot-meta">
    <span class="pager-pages">
      Page {pageInChapter + 1} of {pageCount}
      <span class="muted">· Ch. {chapterIdx + 1} / {chapters.length}</span>
    </span>
    <span class="muted">{progressPct}% through text</span>
  </div>
  <div class="reader-foot-bar"><i style="width: {progressPct}%"></i></div>
</footer>

<style>
  /* The page mode owns the available vertical space between the
     reader top bar and progress foot. The viewport is the fixed-
     height window; .reader-page-content is the (potentially much
     taller) chapter body that translates inside it. */
  .reader-page-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr;
  }

  .reader-page-viewport {
    overflow: hidden;
    padding: 1.25rem 3rem;
  }
  @media (min-width: 1024px) {
    .reader-page-viewport {
      padding: 2rem 5rem;
    }
  }

  .reader-page-content {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.1rem;
    line-height: 2;
    color: var(--ink, var(--color-fg));
    max-width: 40rem;
    margin: 0 auto;
    word-spacing: 0.03em;
    text-wrap: pretty;
    transition: transform 200ms ease;
    will-change: transform;
  }
  @media (min-width: 768px) {
    .reader-page-content {
      font-size: 1.25rem;
    }
  }

  .chapter-h {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    color: var(--ink-3, var(--color-fg-muted));
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--rule, var(--color-border));
    padding-bottom: 0.875rem;
    margin: 0 0 1.75rem;
    font-weight: 400;
  }
  .chapter-h .roman {
    display: block;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.7rem;
    color: var(--ink-4, var(--color-fg-subtle));
    letter-spacing: 0.04em;
    margin-top: 0.3rem;
    text-transform: uppercase;
  }

  /* Floating round page arrows — visible on every viewport so mouse +
     touch users always have an explicit nav affordance (T-5.23). */
  .page-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    color: var(--ink-2, var(--color-fg-muted));
    display: grid;
    place-items: center;
    cursor: pointer;
    z-index: 8;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
    transition:
      background 150ms ease,
      color 150ms ease,
      transform 150ms ease,
      opacity 150ms ease;
    font-size: 1.4rem;
    line-height: 1;
    padding: 0;
  }
  .page-arrow-l {
    left: 0.5rem;
  }
  .page-arrow-r {
    right: 0.5rem;
  }
  @media (min-width: 1024px) {
    .page-arrow-l {
      left: 1rem;
    }
    .page-arrow-r {
      right: 1rem;
    }
  }
  .page-arrow:hover:not(:disabled) {
    background: var(--accent-soft, var(--color-accent));
    color: var(--accent-ink, var(--color-accent-fg, #fff));
    transform: translateY(-50%) scale(1.05);
  }
  .page-arrow:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  .reader-foot {
    border-top: 1px solid var(--rule, var(--color-border));
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 88%,
      var(--paper-2, transparent)
    );
    padding: 0.6rem 1.25rem 0.75rem;
    position: sticky;
    bottom: 0;
  }
  @media (min-width: 768px) {
    .reader-foot {
      padding: 0.75rem 1.75rem 0.9rem;
    }
  }
  .reader-foot-meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin-bottom: 0.4rem;
  }
  .pager-pages {
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
    letter-spacing: 0.04em;
    color: var(--ink-2, var(--color-fg));
  }
  .muted {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .reader-foot-bar {
    height: 3px;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 8%, transparent);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }
  .reader-foot-bar > i {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent, var(--color-accent));
    border-radius: 2px;
    transition: width 250ms ease;
  }

  /* Respect reduced-motion: skip the page-flip slide. */
  @media (prefers-reduced-motion: reduce) {
    .reader-page-content {
      transition: none;
    }
  }
</style>
