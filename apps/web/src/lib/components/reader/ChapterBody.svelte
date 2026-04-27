<!--
  Renders one chapter's body with the right tokenizer (T-5.2).

  When the chapter has server-rendered tokens (the NLP worker has
  run), we render a span per ServerToken with `.status-*` classes
  driving the highlight. Otherwise, we fall back to the client-side
  whitespace tokenizer — every word becomes a `.word` span with no
  status, so the layout still looks right and click-handlers / pop-ups
  can attach (the lemma_id is just null until the worker fills it in).

  Both layout modes (`page`, `paged_scroll`, `continuous`) consume
  this so the rendering rules live in one place.
-->
<script lang="ts">
  import TokenSpan from './TokenSpan.svelte';
  import {
    paragraphsOfServerTokens,
    paragraphsOfTokens,
    tokenize,
    type ChapterView,
  } from './types.js';

  let { chapter }: { chapter: ChapterView } = $props();

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
      {#each paragraph as token (token.id)}<TokenSpan {token} />{/each}
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
    line-height: 1.75;
    font-size: 1.05rem;
  }
  /* The fallback path has its own minimal hover treatment — the real
     status-aware classes live on TokenSpan. */
  .word {
    cursor: pointer;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .word:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
</style>
