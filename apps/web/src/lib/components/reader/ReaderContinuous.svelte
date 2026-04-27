<!--
  Continuous reading mode (T-5.1).

  Renders every chapter stacked vertically. The skeleton uses plain
  paragraph rendering — token spans + the pop-up land in T-5.2 / T-5.4.
  Virtual scrolling for very long books (T-5.1a) is wired by the
  caller's chunking, not here.
-->
<script lang="ts">
  import { paragraphsOfTokens, tokenize, type ChapterView } from './types.js';

  let {
    chapters,
    initialChapterIdx = 0,
  }: { chapters: ChapterView[]; initialChapterIdx?: number } = $props();

  // Memoize tokenization per chapter so a re-render doesn't redo it.
  const tokenizedChapters = $derived(
    chapters.map((c) => ({
      ...c,
      paragraphs: paragraphsOfTokens(tokenize(c.body)),
    })),
  );
</script>

<div class="reader-continuous" data-mode="continuous" data-initial-chapter={initialChapterIdx}>
  {#each tokenizedChapters as chapter (chapter.id)}
    <section
      id={`chapter-${chapter.idx}`}
      class:active={chapter.idx === initialChapterIdx}
    >
      {#if chapter.title || tokenizedChapters.length > 1}
        <h2>
          {chapter.title ?? `Chapter ${chapter.idx + 1}`}
          <span class="muted">({chapter.tokenCount.toLocaleString()} tokens)</span>
        </h2>
      {/if}
      {#each chapter.paragraphs as paragraph, pIdx (pIdx)}
        <p class="body">
          {#each paragraph as token (token.idx)}<span
              class:word={token.isWord}
              data-token-idx={token.idx}>{token.surface}</span>{/each}
        </p>
      {/each}
    </section>
  {/each}
</div>

<style>
  .reader-continuous {
    max-width: 38rem;
    margin: 0 auto;
    padding: 1rem 1.25rem 4rem;
  }
  section {
    margin: 1.5rem 0;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  .muted {
    color: var(--color-fg-muted);
    font-weight: 400;
    font-size: 0.85em;
    margin-left: 0.4rem;
  }
  .body {
    margin: 0 0 1rem;
    line-height: 1.75;
    font-size: 1.05rem;
  }
  /* Words get an inviting hover state so the reader knows they're
     interactive, even before T-5.4's pop-up lands. Whitespace +
     punctuation tokens render as plain text. */
  .word {
    cursor: pointer;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .word:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
</style>
