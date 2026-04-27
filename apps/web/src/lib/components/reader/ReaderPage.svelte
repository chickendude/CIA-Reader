<!--
  Page-mode reader (T-5.1, token-aware in T-5.2).

  Classic LingQ-style pagination: one chapter at a time with prev/next
  buttons. Token rendering is delegated to <ChapterBody/>.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import ChapterBody from './ChapterBody.svelte';
  import type { ChapterView } from './types.js';

  let {
    chapters,
    chapterIdx,
    textId,
  }: { chapters: ChapterView[]; chapterIdx: number; textId: string } = $props();

  const current = $derived(
    chapters[Math.max(0, Math.min(chapterIdx, chapters.length - 1))],
  );
  const hasPrev = $derived(chapterIdx > 0);
  const hasNext = $derived(chapterIdx < chapters.length - 1);

  function go(nextIdx: number) {
    void goto(`/reader/${textId}?mode=page&chapter=${nextIdx}`, {
      keepFocus: true,
    });
  }
</script>

<div class="reader-page" data-mode="page">
  <header class="page-header">
    {#if current}
      <h2>
        {current.title ?? `Chapter ${current.idx + 1}`}
      </h2>
      <p class="muted">
        Chapter {current.idx + 1} of {chapters.length}
        · {current.tokenCount.toLocaleString()} tokens
      </p>
    {/if}
  </header>

  <article>
    {#if current}
      <ChapterBody chapter={current} />
    {/if}
  </article>

  <nav class="pager" aria-label="Chapter navigation">
    <button type="button" disabled={!hasPrev} onclick={() => go(chapterIdx - 1)}>
      ← Previous chapter
    </button>
    <button type="button" disabled={!hasNext} onclick={() => go(chapterIdx + 1)}>
      Next chapter →
    </button>
  </nav>
</div>

<style>
  .reader-page {
    max-width: 38rem;
    margin: 0 auto;
    padding: 1rem 1.25rem 4rem;
  }
  .page-header h2 {
    font-size: 1.2rem;
    margin: 0 0 0.25rem;
  }
  .muted {
    color: var(--color-fg-muted);
    font-size: 0.85rem;
    margin: 0 0 1rem;
  }
  article {
    min-height: 50vh;
  }
  .pager {
    display: flex;
    justify-content: space-between;
    margin-top: 2rem;
    gap: 0.75rem;
  }
  .pager button {
    flex: 1;
    min-height: 44px;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .pager button[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
