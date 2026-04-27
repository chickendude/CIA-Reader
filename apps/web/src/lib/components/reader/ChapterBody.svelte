<!--
  Renders one chapter's body with the right tokenizer (T-5.2,
  romanization in T-5.3, click-to-popup in T-5.4).

  Click handling lives here so the popup is mounted at most once per
  chapter render — wiring it on every TokenSpan would explode for
  large chapters. We delegate via event-bubbling: a click anywhere on
  this region is checked for `[data-token-id]` and an open-popup
  intent is fired if it lands on a word.
-->
<script lang="ts">
  import TokenSpan from './TokenSpan.svelte';
  import WordPopup from './WordPopup.svelte';
  import {
    paragraphsOfServerTokens,
    paragraphsOfTokens,
    tokenize,
    type ChapterView,
    type ServerToken,
  } from './types.js';

  let {
    chapter,
    showRomanization = false,
    isOwner = false,
  }: {
    chapter: ChapterView;
    showRomanization?: boolean;
    isOwner?: boolean;
  } = $props();

  const serverParagraphs = $derived(
    chapter.tokens ? paragraphsOfServerTokens(chapter.tokens) : null,
  );
  const fallbackParagraphs = $derived(
    chapter.tokens ? null : paragraphsOfTokens(tokenize(chapter.body)),
  );

  // Lookup helper — server tokens are keyed by id.
  const tokensById = $derived.by(() => {
    if (!chapter.tokens) return new Map<string, ServerToken>();
    return new Map(chapter.tokens.map((t) => [t.id, t]));
  });

  let activeToken = $state<ServerToken | null>(null);
  let activeRect = $state<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  } | null>(null);

  function onChapterClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const span = target.closest('[data-token-id]') as HTMLElement | null;
    if (!span) return;
    const tokenId = span.getAttribute('data-token-id');
    if (!tokenId) return;
    const token = tokensById.get(tokenId);
    if (!token || !token.isWord) return;
    const rect = span.getBoundingClientRect();
    activeToken = token;
    activeRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
    };
  }

  function closePopup() {
    activeToken = null;
    activeRect = null;
  }

  // T-5.5 wires this to the server. Today it's a no-op stub that just
  // closes the popup so the click feels responsive — the actual
  // status write lands one ticket later. We accept the status arg to
  // keep the signature stable; t-5.5 will use it.
  function onMarkStatus(/* status: 'learning' | 'known' | 'ignored' */) {
    closePopup();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onclick={onChapterClick}>
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
</div>

{#if activeToken && activeRect}
  <WordPopup
    token={activeToken}
    anchorRect={activeRect}
    {isOwner}
    onClose={closePopup}
    {onMarkStatus}
  />
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
