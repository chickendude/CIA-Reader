<!--
  PDF image reader (one page per chapter).

  Shows the original page image with clickable word overlays (the default)
  or a reflowed-text view of the same page's OCR, toggled by the user.
  Both views render through ChapterBody, so the WordPopup / known-words /
  translation machinery is identical to the text reader — the only
  difference is whether ChapterBody gets a `pageImage` prop.

  Page navigation re-runs the loader via `?chapter=N` (same pattern the
  text reader uses for cross-chapter moves), so each page ships its own
  image + tokens on demand.
-->
<script lang="ts">
  import { goto } from '$app/navigation';

  import ChapterBody from './ChapterBody.svelte';
  import { computePctRead } from './reader-progress.js';
  import type { ProgressAnchor } from './progress-client.js';
  import type { ChapterView } from './types.js';
  import type { LanguageCode } from '@ciareader/shared-types';

  let {
    chapters,
    chapterIdx,
    textId,
    language,
    showRomanization = false,
    isOwner = false,
    isAdmin = false,
    onProgress,
  }: {
    chapters: ChapterView[];
    chapterIdx: number;
    textId: string;
    language: LanguageCode;
    showRomanization?: boolean;
    isOwner?: boolean;
    isAdmin?: boolean;
    onProgress?: (anchor: ProgressAnchor) => void;
  } = $props();

  const activeChapter = $derived(chapters[chapterIdx] ?? null);
  const pageCount = $derived(chapters.length);

  // 'image' shows the page scan + clickable overlays; 'text' shows the
  // reflowed OCR. Default to image — that's the whole point of a PDF.
  let view = $state<'image' | 'text'>('image');

  const hasImage = $derived(!!activeChapter?.pageImageUrl);
  const pageImage = $derived(
    activeChapter?.pageImageUrl
      ? {
          url: activeChapter.pageImageUrl,
          width: activeChapter.pageWidth ?? null,
          height: activeChapter.pageHeight ?? null,
        }
      : null,
  );

  function goToPage(idx: number) {
    const clamped = Math.max(0, Math.min(idx, pageCount - 1));
    if (clamped === chapterIdx) return;
    void goto(`/reader/${textId}?chapter=${clamped}`, { keepFocus: true });
  }

  // Report progress as the active page so the resume-anchor + whole-book
  // progress track which page the reader is on.
  $effect(() => {
    const idx = chapterIdx;
    onProgress?.({
      chapterIdx: idx,
      tokenIdx: 0,
      pctRead: computePctRead(chapters, idx, 0),
    });
  });
</script>

<div class="reader-image">
  <div class="page-toolbar">
    <div class="page-nav">
      <button
        type="button"
        onclick={() => goToPage(chapterIdx - 1)}
        disabled={chapterIdx <= 0}
        aria-label="Previous page"
      >‹</button>
      <span class="page-indicator" aria-live="polite">
        Page {chapterIdx + 1} / {pageCount}
      </span>
      <button
        type="button"
        onclick={() => goToPage(chapterIdx + 1)}
        disabled={chapterIdx >= pageCount - 1}
        aria-label="Next page"
      >›</button>
    </div>

    {#if hasImage}
      <div class="view-toggle" role="group" aria-label="Page view">
        <button
          type="button"
          class:active={view === 'image'}
          aria-pressed={view === 'image'}
          onclick={() => (view = 'image')}
        >Image</button>
        <button
          type="button"
          class:active={view === 'text'}
          aria-pressed={view === 'text'}
          onclick={() => (view = 'text')}
        >Text</button>
      </div>
    {/if}
  </div>

  <div class="page-body">
    {#if activeChapter}
      {#key activeChapter.id + ':' + view}
        <ChapterBody
          chapter={activeChapter}
          {language}
          {showRomanization}
          {isOwner}
          {isAdmin}
          {textId}
          pageImage={view === 'image' ? pageImage : null}
        />
      {/key}
    {/if}
  </div>
</div>

<style>
  .reader-image {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .page-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.6rem 1.25rem;
    border-bottom: 1px solid var(--rule, var(--color-border));
  }
  .page-nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .page-nav button,
  .view-toggle button {
    min-height: 34px;
    min-width: 34px;
    padding: 0 0.7rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: transparent;
    color: var(--ink, var(--color-fg));
    font: inherit;
    cursor: pointer;
  }
  .page-nav button[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .page-indicator {
    font-size: 0.85rem;
    color: var(--ink-2, var(--color-fg-muted));
    min-width: 7rem;
    text-align: center;
  }
  .view-toggle {
    display: inline-flex;
    gap: 0.25rem;
  }
  .view-toggle button.active {
    background: var(--accent-soft, var(--color-accent));
    border-color: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-accent-fg, #fff));
  }
  .page-body {
    flex: 1;
    overflow: auto;
    /* Center the page column with comfortable gutters; cap width so a
       page image doesn't stretch absurdly wide on desktop. */
    padding: 1rem;
    display: flex;
    justify-content: center;
  }
  .page-body :global(.page-overlay),
  .page-body :global([dir]) {
    width: 100%;
    max-width: 48rem;
  }
</style>
