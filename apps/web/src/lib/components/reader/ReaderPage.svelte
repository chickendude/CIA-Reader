<!--
  Page-mode reader (T-5.1).

  Classic LingQ-style pagination: one rendered chapter at a time with
  prev/next buttons. Pixel-precise viewport-driven page breaks
  (preventing mid-word cuts) land in T-5.1a + T-5.1c — the skeleton
  here treats one chapter as one page, which keeps the contract for
  the navigation buttons stable while we layer real pagination on.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { paragraphsOfTokens, tokenize, type ChapterView } from './types.js';

  let {
    chapters,
    chapterIdx,
    textId,
  }: { chapters: ChapterView[]; chapterIdx: number; textId: string } = $props();

  const current = $derived(chapters[Math.max(0, Math.min(chapterIdx, chapters.length - 1))]);
  const paragraphs = $derived(
    current ? paragraphsOfTokens(tokenize(current.body)) : [],
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
    {#each paragraphs as paragraph, pIdx (pIdx)}
      <p class="body">
        {#each paragraph as token (token.idx)}<span
            class:word={token.isWord}
            data-token-idx={token.idx}>{token.surface}</span>{/each}
      </p>
    {/each}
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
  .body {
    margin: 0 0 1rem;
    line-height: 1.75;
    font-size: 1.05rem;
  }
  .word {
    cursor: pointer;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .word:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
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
