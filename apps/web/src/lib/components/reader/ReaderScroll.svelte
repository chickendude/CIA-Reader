<!--
  Paged-scroll mode (T-5.1, token-aware in T-5.2).

  Slices the active chapter into pages of ~wordsPerPage word tokens
  along paragraph boundaries (no mid-paragraph cuts). When the chapter
  has server tokens we slice ServerToken paragraphs; otherwise we
  slice the client-tokenized fallback. The render is delegated to a
  per-paragraph TokenSpan render so all three modes share styles.
-->
<script lang="ts">
  import TokenSpan from './TokenSpan.svelte';
  import {
    paragraphsOfServerTokens,
    paragraphsOfTokens,
    tokenize,
    type ChapterView,
    type RenderToken,
    type ServerToken,
  } from './types.js';

  let {
    chapters,
    chapterIdx,
    wordsPerPage = 250,
    showRomanization = false,
  }: {
    chapters: ChapterView[];
    chapterIdx: number;
    wordsPerPage?: number;
    showRomanization?: boolean;
  } = $props();

  let page = $state(0);

  const current = $derived(
    chapters[Math.max(0, Math.min(chapterIdx, chapters.length - 1))],
  );

  // Source-of-tokens decision happens once per chapter — server
  // tokens beat the client fallback.
  type ParaServer = ServerToken[];
  type ParaFallback = RenderToken[];
  const serverParagraphs = $derived(
    current && current.tokens
      ? paragraphsOfServerTokens(current.tokens)
      : null,
  );
  const fallbackParagraphs = $derived(
    current && !current.tokens ? paragraphsOfTokens(tokenize(current.body)) : null,
  );

  function packServer(paragraphs: ParaServer[]): ParaServer[][] {
    const out: ParaServer[][] = [];
    let buf: ParaServer[] = [];
    let bufWords = 0;
    for (const p of paragraphs) {
      const words = p.filter((t) => t.isWord).length;
      if (bufWords > 0 && bufWords + words > wordsPerPage) {
        out.push(buf);
        buf = [];
        bufWords = 0;
      }
      buf.push(p);
      bufWords += words;
    }
    if (buf.length > 0) out.push(buf);
    if (out.length === 0) out.push([]);
    return out;
  }

  function packFallback(paragraphs: ParaFallback[]): ParaFallback[][] {
    const out: ParaFallback[][] = [];
    let buf: ParaFallback[] = [];
    let bufWords = 0;
    for (const p of paragraphs) {
      const words = p.filter((t) => t.isWord).length;
      if (bufWords > 0 && bufWords + words > wordsPerPage) {
        out.push(buf);
        buf = [];
        bufWords = 0;
      }
      buf.push(p);
      bufWords += words;
    }
    if (buf.length > 0) out.push(buf);
    if (out.length === 0) out.push([]);
    return out;
  }

  const serverPages = $derived(serverParagraphs ? packServer(serverParagraphs) : null);
  const fallbackPages = $derived(
    fallbackParagraphs ? packFallback(fallbackParagraphs) : null,
  );
  const pageCount = $derived(serverPages?.length ?? fallbackPages?.length ?? 1);

  const clampedPage = $derived(Math.max(0, Math.min(page, pageCount - 1)));
  const visibleServer = $derived(serverPages ? serverPages[clampedPage] ?? [] : null);
  const visibleFallback = $derived(
    fallbackPages ? fallbackPages[clampedPage] ?? [] : null,
  );
  const hasPrev = $derived(clampedPage > 0);
  const hasNext = $derived(clampedPage < pageCount - 1);

  function prev() {
    if (hasPrev) page = clampedPage - 1;
  }
  function next() {
    if (hasNext) page = clampedPage + 1;
  }
</script>

<div class="reader-scroll" data-mode="paged-scroll">
  <header class="page-header">
    {#if current}
      <h2>
        {current.title ?? `Chapter ${current.idx + 1}`}
      </h2>
      <p class="muted">
        Page {clampedPage + 1} of {pageCount}
        · {wordsPerPage.toLocaleString()} words/page
      </p>
    {/if}
  </header>

  <article>
    {#if visibleServer}
      {#each visibleServer as paragraph, pIdx (pIdx)}
        <p class="body">
          {#each paragraph as token (token.id)}<TokenSpan
              {token}
              {showRomanization}
            />{/each}
        </p>
      {/each}
    {:else if visibleFallback}
      {#each visibleFallback as paragraph, pIdx (pIdx)}
        <p class="body">
          {#each paragraph as token (token.idx)}<span
              class:word={token.isWord}
              data-token-idx={token.idx}>{token.surface}</span>{/each}
        </p>
      {/each}
    {/if}
  </article>

  <nav class="pager" aria-label="Page navigation">
    <button type="button" disabled={!hasPrev} onclick={prev}>← Previous page</button>
    <button type="button" disabled={!hasNext} onclick={next}>Next page →</button>
  </nav>
</div>

<style>
  .reader-scroll {
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
