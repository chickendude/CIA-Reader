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

  import WordPopup from './WordPopup.svelte';

  let {
    chapters,
    chapterIdx,
    wordsPerPage = 250,
    showRomanization = false,
    isOwner = false,
  }: {
    chapters: ChapterView[];
    chapterIdx: number;
    wordsPerPage?: number;
    showRomanization?: boolean;
    isOwner?: boolean;
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

  // Same click → popup pattern as ChapterBody — duplicated rather
  // than refactored because ReaderScroll also slices by paragraph
  // packing, and the shared component would have to know about
  // pages.
  const tokensById = $derived.by(() => {
    if (!current?.tokens) return new Map<string, ServerToken>();
    return new Map(current.tokens.map((t) => [t.id, t]));
  });

  let activeToken = $state<ServerToken | null>(null);
  let activeRect = $state<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  } | null>(null);

  function onArticleClick(event: MouseEvent) {
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

  let statusOverrides = $state(new Map<string, ServerToken['status']>());
  function onStatusChange(lemmaId: string, status: ServerToken['status']) {
    const next = new Map(statusOverrides);
    next.set(lemmaId, status);
    statusOverrides = next;
  }

  // T-5.7: ←/→ flip pages within the chapter.
  function isTypingInsideElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingInsideElement(e.target)) return;
    if (document.querySelector('[data-testid="word-popup"]')) return;
    if (e.key === 'ArrowLeft' && hasPrev) {
      e.preventDefault();
      prev();
    } else if (e.key === 'ArrowRight' && hasNext) {
      e.preventDefault();
      next();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="reader-scroll" data-mode="paged-scroll">
  <button
    type="button"
    class="page-arrow page-arrow-l"
    aria-label="Previous page"
    disabled={!hasPrev}
    onclick={prev}
  >
    ‹
  </button>

  <div class="reader-scroll-inner">
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

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <article onclick={onArticleClick}>
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
  </div>

  <button
    type="button"
    class="page-arrow page-arrow-r"
    aria-label="Next page"
    disabled={!hasNext}
    onclick={next}
  >
    ›
  </button>
</div>

{#if activeToken && activeRect}
  <WordPopup
    token={activeToken}
    anchorRect={activeRect}
    {isOwner}
    onClose={closePopup}
    {onStatusChange}
  />
{/if}

<style>
  /* T-5.24: scroll mode now uses the same floating round arrows as
     page mode (T-5.9) so mouse + touch users always have a click
     target. The text column itself flows naturally — the user can
     still scroll within a page. */
  .reader-scroll {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0;
  }
  .reader-scroll-inner {
    max-width: 40rem;
    margin: 0 auto;
    padding: 1.25rem 3rem 2rem;
  }
  @media (min-width: 1024px) {
    .reader-scroll-inner {
      padding: 2rem 5rem 2.5rem;
    }
  }
  .page-header h2 {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    color: var(--ink-3, var(--color-fg-muted));
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--rule, var(--color-border));
    padding-bottom: 0.85rem;
    margin: 0 0 0.5rem;
    font-weight: 400;
  }
  .muted {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
    margin: 0 0 1rem;
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  article {
    min-height: 50vh;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.1rem;
    line-height: 2;
    color: var(--ink, var(--color-fg));
    word-spacing: 0.03em;
    text-wrap: pretty;
  }
  @media (min-width: 768px) {
    article {
      font-size: 1.25rem;
    }
  }
  .body {
    margin: 0 0 1rem;
  }
  .word {
    cursor: pointer;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .word:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }

  /* Floating round page arrows — same treatment as ReaderPage. */
  .page-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    color: var(--ink-2, var(--color-fg-muted));
    display: grid;
    place-items: center;
    cursor: pointer;
    z-index: 8;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
    transition:
      background 150ms ease,
      color 150ms ease,
      transform 150ms ease,
      opacity 150ms ease;
    font-size: 1.4rem;
    line-height: 1;
    padding: 0;
  }
  .page-arrow-l {
    left: 0.5rem;
  }
  .page-arrow-r {
    right: 0.5rem;
  }
  @media (min-width: 1024px) {
    .page-arrow-l {
      left: 1rem;
    }
    .page-arrow-r {
      right: 1rem;
    }
  }
  .page-arrow:hover:not(:disabled) {
    background: var(--accent-soft, var(--color-accent));
    color: var(--accent-ink, var(--color-accent-fg, #fff));
    transform: translateY(-50%) scale(1.05);
  }
  .page-arrow:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }
</style>
