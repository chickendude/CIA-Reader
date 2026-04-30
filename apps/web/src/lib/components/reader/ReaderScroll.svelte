<!--
  Paged-scroll mode (T-5.1, token-aware in T-5.2).

  Slices the active chapter into pages of ~wordsPerPage word tokens
  along paragraph boundaries (no mid-paragraph cuts). When the chapter
  has server tokens we slice ServerToken paragraphs; otherwise we
  slice the client-tokenized fallback. The render is delegated to a
  per-paragraph TokenSpan render so all three modes share styles.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';

  import TokenSpan from './TokenSpan.svelte';
  import type { ProgressAnchor } from './progress-client.js';
  import {
    computePctRead,
    findFirstVisibleWordAnchor,
    firstTokenPage,
    readableRect,
  } from './reader-progress.js';
  import {
    paragraphsOfServerTokens,
    paragraphsOfTokens,
    tokenize,
    type ChapterView,
    type RenderToken,
    type ServerToken,
  } from './types.js';

  import WordPopup from './WordPopup.svelte';
  import WordTooltip from './WordTooltip.svelte';

  let {
    chapters,
    chapterIdx,
    initialTokenIdx = 0,
    wordsPerPage = 250,
    showRomanization = false,
    isOwner = false,
    language,
    onProgress,
  }: {
    chapters: ChapterView[];
    chapterIdx: number;
    initialTokenIdx?: number;
    wordsPerPage?: number;
    showRomanization?: boolean;
    isOwner?: boolean;
    language: import('@ciareader/shared-types').LanguageCode;
    onProgress?: (anchor: ProgressAnchor) => void;
  } = $props();

  let page = $state(0);
  let articleEl: HTMLElement | null = $state(null);
  let initialTokenApplied = $state(false);
  let restorePaintReady = $state(false);
  let lastReportedKey = '';
  let reportRaf = 0;
  const isRestoringInitialToken = $derived(
    initialTokenIdx > 0 && (!initialTokenApplied || !restorePaintReady),
  );

  const current = $derived(chapters[Math.max(0, Math.min(chapterIdx, chapters.length - 1))]);

  // Source-of-tokens decision happens once per chapter — server
  // tokens beat the client fallback.
  type ParaServer = ServerToken[];
  type ParaFallback = RenderToken[];
  // T-6.1: apply per-token lemma corrections + per-lemma status
  // overrides before paragraph splitting so the new picks colour
  // the rendered tokens immediately.
  const correctedTokens = $derived.by(() => {
    if (!current?.tokens) return null;
    if (statusOverrides.size === 0 && lemmaCorrections.size === 0) {
      return current.tokens;
    }
    return current.tokens.map((t) => {
      const correctedLemmaId = lemmaCorrections.get(t.id);
      let next = t;
      if (correctedLemmaId && correctedLemmaId !== t.lemmaId) {
        const chosen = t.candidates.find((c) => c.lemmaId === correctedLemmaId);
        if (chosen) {
          const remaining = t.candidates.filter((c) => c.lemmaId !== correctedLemmaId);
          next = {
            ...t,
            lemmaId: chosen.lemmaId,
            glossDefault: chosen.glossDefault ?? t.glossDefault,
            candidates: remaining,
            isAmbiguous: remaining.length > 0,
          };
        }
      }
      if (next.lemmaId && statusOverrides.has(next.lemmaId)) {
        next = { ...next, status: statusOverrides.get(next.lemmaId)! };
      }
      return next;
    });
  });
  const serverParagraphs = $derived(
    correctedTokens ? paragraphsOfServerTokens(correctedTokens) : null,
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
  const fallbackPages = $derived(fallbackParagraphs ? packFallback(fallbackParagraphs) : null);
  const activePages = $derived(serverPages ?? fallbackPages);
  const pageCount = $derived(serverPages?.length ?? fallbackPages?.length ?? 1);

  const clampedPage = $derived(Math.max(0, Math.min(page, pageCount - 1)));
  const visibleServer = $derived(serverPages ? (serverPages[clampedPage] ?? []) : null);
  const visibleFallback = $derived(fallbackPages ? (fallbackPages[clampedPage] ?? []) : null);
  const hasPrev = $derived(clampedPage > 0);
  const hasNext = $derived(clampedPage < pageCount - 1);

  function prev() {
    if (hasPrev) page = clampedPage - 1;
  }
  function next() {
    if (hasNext) page = clampedPage + 1;
  }

  $effect(() => {
    void chapterIdx;
    void initialTokenIdx;
    page = 0;
    initialTokenApplied = false;
    restorePaintReady = initialTokenIdx <= 0;
    lastReportedKey = '';
  });

  $effect(() => {
    void initialTokenIdx;
    void pageCount;
    void activePages;
    if (initialTokenApplied) return;
    initialTokenApplied = true;
    page = firstTokenPage(activePages, initialTokenIdx);
    if (initialTokenIdx > 0) {
      void tick().then(() => {
        window.requestAnimationFrame(() => {
          restorePaintReady = true;
        });
      });
    }
  });

  function reportProgress() {
    reportRaf = 0;
    if (!onProgress || !articleEl) return;
    // Same guard as ReaderPage — don't mirror an anchor while the
    // viewport mask is up; the page might still be 0 before the
    // restore-jump effect runs.
    if (isRestoringInitialToken) return;
    const anchor = findFirstVisibleWordAnchor(articleEl, {
      clip: readableRect(articleEl),
      fallbackChapterIdx: chapterIdx,
      minVisiblePx: 4,
    });
    if (!anchor) return;
    const next: ProgressAnchor = {
      ...anchor,
      pctRead: computePctRead(chapters, anchor.chapterIdx, anchor.tokenIdx, {
        completedText: anchor.chapterIdx >= chapters.length - 1 && clampedPage >= pageCount - 1,
      }),
    };
    const key = `${next.chapterIdx}:${next.tokenIdx}:${next.pctRead}`;
    if (key === lastReportedKey) return;
    lastReportedKey = key;
    onProgress(next);
  }

  function queueProgressReport() {
    if (reportRaf) return;
    reportRaf = window.requestAnimationFrame(reportProgress);
  }

  onMount(() => {
    window.addEventListener('scroll', queueProgressReport, { passive: true });
    window.addEventListener('resize', queueProgressReport);
    void tick().then(queueProgressReport);
    return () => {
      window.removeEventListener('scroll', queueProgressReport);
      window.removeEventListener('resize', queueProgressReport);
      if (reportRaf) window.cancelAnimationFrame(reportRaf);
    };
  });

  $effect(() => {
    void clampedPage;
    void pageCount;
    void visibleServer;
    void visibleFallback;
    void showRomanization;
    void tick().then(queueProgressReport);
  });

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

  // T-5.29: hover wiring matches ChapterBody (used by ReaderPage) so
  // both modes show the WordTooltip on word hover.
  let hoverToken = $state<ServerToken | null>(null);
  let hoverRect = $state<{
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
  } | null>(null);

  function findToken(target: HTMLElement | null): {
    token: ServerToken;
    el: HTMLElement;
  } | null {
    if (!target) return null;
    const span = target.closest('[data-token-id]') as HTMLElement | null;
    if (!span) return null;
    const tokenId = span.getAttribute('data-token-id');
    if (!tokenId) return null;
    const token = tokensById.get(tokenId);
    if (!token || !token.isWord) return null;
    return { token, el: span };
  }

  function onArticleClick(event: MouseEvent) {
    const found = findToken(event.target as HTMLElement);
    if (!found) return;
    const rect = found.el.getBoundingClientRect();
    activeToken = found.token;
    activeRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
    };
    hoverToken = null;
    hoverRect = null;
    // T-9.4: tap-to-seek. Same flow as ChapterBody — audio
    // alignment + player handle, no-op when neither is present.
    void (async () => {
      const { getAlignmentStartMs, getAudioController } = await import('./audio-bus.js');
      const startMs = getAlignmentStartMs(found.token.id);
      if (startMs == null) return;
      const ctrl = getAudioController();
      if (!ctrl) return;
      ctrl.pause();
      ctrl.seekMs(startMs);
    })();
  }

  function showHoverTooltip(event: Event) {
    const found = findToken(event.target as HTMLElement);
    if (!found) {
      hoverToken = null;
      hoverRect = null;
      return;
    }
    if (activeToken && activeToken.id === found.token.id) {
      hoverToken = null;
      hoverRect = null;
      return;
    }
    const rect = found.el.getBoundingClientRect();
    hoverToken = found.token;
    hoverRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    };
  }

  function hideHoverTooltip(event: Event) {
    const related = 'relatedTarget' in event ? (event.relatedTarget as HTMLElement | null) : null;
    if (related && (event.currentTarget as HTMLElement).contains(related)) {
      return;
    }
    hoverToken = null;
    hoverRect = null;
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

  // T-6.1: scroll mode shares the per-token correction state pattern
  // with ChapterBody so picking an alternate lemma in the popup
  // re-renders the corrected token on the current page immediately.
  let lemmaCorrections = $state(new Map<string, string>());
  function onCorrectionApplied(tokenId: string, chosenLemmaId: string | null) {
    const next = new Map(lemmaCorrections);
    if (chosenLemmaId == null) {
      next.delete(tokenId);
    } else {
      next.set(tokenId, chosenLemmaId);
    }
    lemmaCorrections = next;
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

  <div class="reader-scroll-inner" data-restoring={isRestoringInitialToken ? '1' : undefined}>
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
    <!-- svelte-ignore a11y_mouse_events_have_key_events -->
    <article
      bind:this={articleEl}
      onclick={onArticleClick}
      onmouseover={showHoverTooltip}
      onmouseout={hideHoverTooltip}
      onfocusin={showHoverTooltip}
      onfocusout={hideHoverTooltip}
    >
      {#if visibleServer}
        {#each visibleServer as paragraph, pIdx (pIdx)}
          <p class="body">
            {#each paragraph as token (token.id)}<TokenSpan {token} {showRomanization} />{/each}
          </p>
        {/each}
      {:else if visibleFallback}
        {#each visibleFallback as paragraph, pIdx (pIdx)}
          <p class="body">
            {#each paragraph as token (token.idx)}<span
                class:word={token.isWord}
                data-token-idx={token.idx}>{token.surface}</span
              >{/each}
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

{#if hoverToken && hoverRect}
  <WordTooltip token={hoverToken} anchorRect={hoverRect} {language} />
{/if}

{#if activeToken && activeRect}
  <WordPopup
    token={activeToken}
    anchorRect={activeRect}
    {language}
    {isOwner}
    onClose={closePopup}
    {onStatusChange}
    {onCorrectionApplied}
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
    max-width: var(--reader-col-width, 40rem);
    margin: 0 auto;
    padding: 1.25rem 3rem 2rem;
  }
  .reader-scroll-inner[data-restoring='1'] {
    opacity: 0;
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
    font-family: var(--reader-font-family, var(--font-serif-dev, var(--font-serif)));
    font-size: var(--reader-font-size, 1.1rem);
    line-height: var(--reader-line-height, 2);
    color: var(--ink, var(--color-fg));
    word-spacing: 0.03em;
    text-wrap: pretty;
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
