<!--
  Renders one chapter's body with the right tokenizer (T-5.2,
  romanization wired in T-5.3).
-->
<script lang="ts">
  import TokenSpan from './TokenSpan.svelte';
  import {
    paragraphsOfServerTokens,
    paragraphsOfTokens,
    tokenize,
    type ChapterView,
  } from './types.js';

  let {
    chapter,
    showRomanization = false,
  }: { chapter: ChapterView; showRomanization?: boolean } = $props();

  const serverParagraphs = $derived(
    chapter.tokens ? paragraphsOfServerTokens(chapter.tokens) : null,
  );
  const fallbackParagraphs = $derived(
    chapter.tokens ? null : paragraphsOfTokens(tokenize(chapter.body)),
  );
</script>

{#if serverParagraphs}
  {#each serverParagraphs as paragraph, pIdx (pIdx)}
    <p class="body">
      {#each paragraph as token (token.id)}<TokenSpan
          {token}
          {showRomanization}
        />{/each}
    </p>
  {/each}
{:else if fallbackParagraphs}
  {#each fallbackParagraphs as paragraph, pIdx (pIdx)}
    <p class="body">
      {#each paragraph as token (token.idx)}<span
          class:word={token.isWord}
          data-token-idx={token.idx}>{token.surface}</span>{/each}
    </p>
  {/each}
{/if}

<style>
  .body {
    margin: 0 0 1rem;
    line-height: 1.85;
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
</style>
