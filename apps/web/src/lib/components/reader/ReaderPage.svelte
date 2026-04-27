<!--
  Page-mode reader (T-5.1, token-aware in T-5.2, chrome polish in T-5.9).

  Classic LingQ-style pagination: one chapter at a time. Chrome layout
  follows the CIAR design — chapter heading at the top, body in a
  comfortable max-width column, floating round page-arrow buttons
  flanking the column, and a bottom progress bar showing chapter
  position. Token rendering is delegated to <ChapterBody/>.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import ChapterBody from './ChapterBody.svelte';
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
  const hasPrev = $derived(chapterIdx > 0);
  const hasNext = $derived(chapterIdx < chapters.length - 1);
  const progressPct = $derived(
    chapters.length > 0
      ? Math.round(((chapterIdx + 1) / chapters.length) * 100)
      : 0,
  );

  function go(nextIdx: number) {
    void goto(`/reader/${textId}?mode=page&chapter=${nextIdx}`, {
      keepFocus: true,
    });
  }

  // T-5.7: ←/→ flip pages. We listen on the window so the user
  // doesn't have to first click the reader to focus it. Skip
  // when typing in a form / textarea / contenteditable element so
  // we don't hijack legitimate input.
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
    // Don't fight the popup — when it's mounted, it owns the
    // keyboard. The popup itself stops Esc / k / l / i propagation.
    if (document.querySelector('[data-testid="word-popup"]')) return;
    if (e.key === 'ArrowLeft' && hasPrev) {
      e.preventDefault();
      go(chapterIdx - 1);
    } else if (e.key === 'ArrowRight' && hasNext) {
      e.preventDefault();
      go(chapterIdx + 1);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="reader-page-wrap" data-mode="page">
  <button
    type="button"
    class="page-arrow page-arrow-l"
    aria-label="Previous chapter"
    disabled={!hasPrev}
    onclick={() => hasPrev && go(chapterIdx - 1)}
  >
    ‹
  </button>

  <div class="reader-page">
    {#if current}
      <header class="chapter-h">
        {current.title ?? `Chapter ${current.idx + 1}`}
        <span class="roman">
          Chapter {current.idx + 1} of {chapters.length}
          · {current.tokenCount.toLocaleString()} tokens
        </span>
      </header>
    {/if}

    <article>
      {#if current}
        <ChapterBody chapter={current} {showRomanization} {isOwner} />
      {/if}
    </article>
  </div>

  <button
    type="button"
    class="page-arrow page-arrow-r"
    aria-label="Next chapter"
    disabled={!hasNext}
    onclick={() => hasNext && go(chapterIdx + 1)}
  >
    ›
  </button>
</div>

<footer class="reader-foot" aria-label="Chapter progress">
  <div class="reader-foot-meta">
    <span class="pager-pages">
      Chapter {chapterIdx + 1} of {chapters.length}
    </span>
    <span class="muted">{progressPct}% through text</span>
  </div>
  <div class="reader-foot-bar"><i style="width: {progressPct}%"></i></div>
</footer>

<style>
  .reader-page-wrap {
    position: relative;
    padding: 1.5rem 1rem 2.5rem;
  }
  @media (min-width: 1024px) {
    .reader-page-wrap {
      padding: 2.5rem 4.5rem 3rem;
    }
  }
  .reader-page {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.1rem;
    line-height: 2;
    color: var(--ink, var(--color-fg));
    max-width: 40rem;
    margin: 0 auto;
    word-spacing: 0.03em;
    text-wrap: pretty;
  }
  @media (min-width: 768px) {
    .reader-page {
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
  article {
    min-height: 50vh;
  }

  /* Floating round page arrows. Hidden on narrow viewports — keyboard
     ←/→ and the bottom progress bar still work, and the arrows would
     overlap the body column anyway below the breakpoint. */
  .page-arrow {
    display: none;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    color: var(--ink-2, var(--color-fg-muted));
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
  @media (min-width: 1024px) {
    .page-arrow {
      display: grid;
    }
  }
  .page-arrow-l {
    left: 1rem;
  }
  .page-arrow-r {
    right: 1rem;
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
</style>
