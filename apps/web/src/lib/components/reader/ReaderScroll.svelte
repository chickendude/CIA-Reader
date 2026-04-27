<!--
  Paged-scroll mode (T-5.1).

  Shows a fixed words-per-page slice of the current chapter; the
  scroll bar is bounded to that page. Prev/next buttons advance by
  one page of N words. The page break respects paragraph boundaries
  so we never cut mid-paragraph.

  T-5.1b adds the user-configurable words-per-page setting; the
  skeleton hard-codes a sensible default.
-->
<script lang="ts">
  import { paragraphsOfTokens, tokenize, type ChapterView } from './types.js';

  let {
    chapters,
    chapterIdx,
    wordsPerPage = 250,
  }: {
    chapters: ChapterView[];
    chapterIdx: number;
    wordsPerPage?: number;
  } = $props();

  let page = $state(0);

  const current = $derived(
    chapters[Math.max(0, Math.min(chapterIdx, chapters.length - 1))],
  );
  const paragraphs = $derived(
    current ? paragraphsOfTokens(tokenize(current.body)) : [],
  );

  // Pack paragraphs into pages of ~wordsPerPage word tokens. Same
  // paragraph-integrity rule as the chunker (T-4.2): a single oversized
  // paragraph stays whole, even if that overshoots the target.
  const pages = $derived.by(() => {
    const out: (typeof paragraphs)[] = [];
    let buf: typeof paragraphs = [];
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
  });

  const clampedPage = $derived(Math.max(0, Math.min(page, pages.length - 1)));
  const visible = $derived(pages[clampedPage] ?? []);
  const hasPrev = $derived(clampedPage > 0);
  const hasNext = $derived(clampedPage < pages.length - 1);

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
        Page {clampedPage + 1} of {pages.length}
        · {wordsPerPage.toLocaleString()} words/page
      </p>
    {/if}
  </header>

  <article>
    {#each visible as paragraph, pIdx (pIdx)}
      <p class="body">
        {#each paragraph as token (token.idx)}<span
            class:word={token.isWord}
            data-token-idx={token.idx}>{token.surface}</span>{/each}
      </p>
    {/each}
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
