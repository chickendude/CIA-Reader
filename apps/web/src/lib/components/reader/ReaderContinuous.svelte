<!--
  Continuous reading mode (T-5.1, token-aware in T-5.2).

  Renders every chapter stacked vertically. Token rendering is
  delegated to <ChapterBody/> so all three modes use the same
  status/OOV/ambiguous logic. Virtual scrolling for very long books
  (T-5.1a) is wired by the caller's chunking, not here.
-->
<script lang="ts">
  import ChapterBody from './ChapterBody.svelte';
  import type { ChapterView } from './types.js';

  let {
    chapters,
    initialChapterIdx = 0,
    showRomanization = false,
    isOwner = false,
  }: {
    chapters: ChapterView[];
    initialChapterIdx?: number;
    showRomanization?: boolean;
    isOwner?: boolean;
  } = $props();
</script>

<div class="reader-continuous" data-mode="continuous" data-initial-chapter={initialChapterIdx}>
  {#each chapters as chapter (chapter.id)}
    <section
      id={`chapter-${chapter.idx}`}
      class:active={chapter.idx === initialChapterIdx}
    >
      {#if chapter.title || chapters.length > 1}
        <h2>
          {chapter.title ?? `Chapter ${chapter.idx + 1}`}
          <span class="muted">({chapter.tokenCount.toLocaleString()} tokens)</span>
        </h2>
      {/if}
      <ChapterBody {chapter} {showRomanization} {isOwner} />
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
</style>
