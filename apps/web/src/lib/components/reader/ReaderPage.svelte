<!--
  Page-mode reader (T-5.1, token-aware in T-5.2, chrome polish in T-5.9,
  no-scroll pagination in T-5.23, horizontal column flow now).

  The chapter renders into a fixed-size viewport that hides overflow
  and uses CSS multi-column with `column-width = viewport-width` so
  content snake-flows into one tall column per page, side-by-side.
  translateX slides between pages — like flipping a book's spread —
  instead of slicing the chapter vertically. Off-screen content stays
  in the DOM (screen readers + Cmd-F still find it).

  Side arrows + keyboard ←/→ step through pages within a chapter and
  spill over into the prev/next chapter at the boundaries. The
  bottom progress foot reports both the page-in-chapter and the
  overall chapter position.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';

  import ChapterBody from './ChapterBody.svelte';
  import { clampPage, pageCountFor, pageOffset } from './paginate.js';
  import type { ProgressAnchor } from './progress-client.js';
  import {
    WORD_SELECTOR,
    buildPageWordIndex,
    columnIndexForElement,
    computePctRead,
    findTokenElementAtOrAfter,
    firstWordInColumnFromIndex,
    formatPctRange,
    pageBoundaryAnchor,
    pctPrecisionFor,
    type PageWordIndex,
  } from './reader-progress.js';
  import { classifySwipe } from './touch-gestures.js';
  import type { ChapterView } from './types.js';

  let {
    chapters,
    chapterIdx,
    initialTokenIdx = 0,
    textId,
    language,
    showRomanization = false,
    isOwner = false,
    isAdmin = false,
    onProgress,
    fontSize,
    lineSpacing,
    fontFamily,
    readingWidth,
    prevTextId = null,
    nextTextId = null,
    collectionPosition = null,
    collectionTotal = null,
    startAtEndOfChapter = false,
  }: {
    chapters: ChapterView[];
    chapterIdx: number;
    initialTokenIdx?: number;
    textId: string;
    language: import('@ciareader/shared-types').LanguageCode;
    showRomanization?: boolean;
    isOwner?: boolean;
    isAdmin?: boolean;
    onProgress?: (anchor: ProgressAnchor) => void;
    fontSize?: number;
    lineSpacing?: number;
    fontFamily?: string | null;
    readingWidth?: string;
    /** When true, mount on the LAST page of the chapter rather than
     *  page 0. Used by the cross-text "prev" handoff so a reader
     *  stepping back off page 1 of chapter N lands at the end of
     *  chapter N-1 (where they'd naturally resume reading). */
    startAtEndOfChapter?: boolean;
    /** Sibling text in the containing collection — when supplied,
     *  the prev/next buttons advance into that text once we exhaust
     *  pages + chapters in the current text. Critical for chapter
     *  books where each chapter is its own one-chapter `texts` row
     *  (otherwise the next button greys out at the end of every
     *  chapter). */
    prevTextId?: string | null;
    nextTextId?: string | null;
    /** Current text's 0-based position within its containing
     *  collection (null when not in a collection). Used to show
     *  "Ch. 6 / 48" in the chapter counter instead of the
     *  uninformative "Ch. 1 / 1" you'd see on a one-chapter text. */
    collectionPosition?: number | null;
    collectionTotal?: number | null;
  } = $props();

  const current = $derived(chapters[Math.max(0, Math.min(chapterIdx, chapters.length - 1))]);
  // Chapter-book chapters prepend the title to their body so the
  // NLP pipeline tokenizes the title alongside the rest. When that
  // happened, the body's first paragraph IS the title — render only
  // that, not a duplicate `<header>` chrome on top.
  const titleInBody = $derived.by(() => {
    const t = current?.title?.trim();
    if (!t) return false;
    const body = current?.body?.trimStart() ?? '';
    return body.startsWith(t);
  });
  const hasPrevChapter = $derived(chapterIdx > 0);
  const hasNextChapter = $derived(chapterIdx < chapters.length - 1);
  const hasPrevText = $derived(prevTextId !== null);
  const hasNextText = $derived(nextTextId !== null);

  // For chapter counters, prefer the collection-level position when
  // this text is itself a single-chapter member of a chapter-book
  // (otherwise the counter would always read "Ch. 1 / 1"). For
  // multi-chapter texts — paste/.txt with auto-split, or
  // course-style collections of multi-chapter texts — the
  // within-text position stays correct.
  const useCollectionCounter = $derived(
    chapters.length === 1 &&
      collectionPosition !== null &&
      collectionTotal !== null,
  );
  const counterCurrent = $derived(
    useCollectionCounter ? collectionPosition! + 1 : chapterIdx + 1,
  );
  const counterTotal = $derived(
    useCollectionCounter ? collectionTotal! : chapters.length,
  );

  // Pagination state. Recomputed on resize / chapter change /
  // showRomanization toggle (which changes line-height).
  // pageW is one column's width (= the viewport's content-box width);
  // contentW is the multicolumn container's total scrollWidth across
  // every column laid out side-by-side.
  let viewportEl: HTMLDivElement | null = $state(null);
  let contentEl: HTMLDivElement | null = $state(null);
  let pageW = $state(0);
  let contentW = $state(0);
  let pageInChapter = $state(0);
  let initialTokenApplied = $state(false);
  let restorePaintReady = $state(false);
  let lastReportedKey = '';
  const isRestoringInitialToken = $derived(
    initialTokenIdx > 0 && (!initialTokenApplied || !restorePaintReady),
  );

  const pageCount = $derived(pageCountFor(contentW, pageW));
  const offset = $derived(pageOffset(pageInChapter, pageW));

  // Reset to the first page whenever the chapter changes — the user
  // shouldn't see "stuck" mid-page state when they navigate.
  $effect(() => {
    void chapterIdx;
    void initialTokenIdx;
    pageInChapter = 0;
    initialTokenApplied = false;
    restorePaintReady = initialTokenIdx <= 0;
    lastReportedKey = '';
    columnIndexCache = null;
    const seed = computePctRead(chapters, chapterIdx, initialTokenIdx);
    startPct = seed;
    endPct = seed;
  });

  // Keep pageInChapter in range when pageCount shrinks (e.g. window
  // grows so the chapter fits in fewer pages).
  $effect(() => {
    pageInChapter = clampPage(pageInChapter, pageCount);
  });

  const hasPrevPage = $derived(pageInChapter > 0);
  const hasNextPage = $derived(pageInChapter < pageCount - 1);
  const hasPrev = $derived(hasPrevPage || hasPrevChapter || hasPrevText);
  const hasNext = $derived(hasNextPage || hasNextChapter || hasNextText);
  // True when clicking next / prev will leave the current chapter
  // (advance to a sibling chapter within this text OR to a sibling
  // text in the surrounding collection). Used to give the arrow
  // button a slightly different appearance + aria-label so readers
  // notice they're crossing a chapter boundary.
  const nextLeavesChapter = $derived(
    !hasNextPage && (hasNextChapter || hasNextText),
  );
  const prevLeavesChapter = $derived(
    !hasPrevPage && (hasPrevChapter || hasPrevText),
  );

  // Overall progress — fraction of the whole text in *words*, not pages.
  // A page with 10 words must advance the bar less than a page with 500.
  // We track two values: `startPct` is the position of the first
  // visible word on the page (= where you'd resume), `endPct` is the
  // position of the first word on the *next* page (= what you've read
  // up through). Footer shows the range. The bar fill follows endPct
  // and the value persisted to the server is endPct, so the library
  // card and reader footer always agree.
  let startPct = $state(0);
  let endPct = $state(0);

  const totalTokens = $derived(chapters.reduce((sum, c) => sum + Math.max(0, c.tokenCount), 0));
  const pctPrecision = $derived(pctPrecisionFor(totalTokens));

  // Per-measure cache of word→column mapping. `findFirstWordInColumn`
  // forces a layout flush per token; building once per measure and
  // serving both the current-page and next-page anchors from the same
  // index drops the page-flip cost in half (and keeps it constant
  // regardless of how many additional anchors we ever query).
  let columnIndexCache: PageWordIndex | null = null;

  function go(nextIdx: number, opts: { lastPage?: boolean } = {}) {
    void goto(`/reader/${textId}?mode=page&chapter=${nextIdx}`, {
      keepFocus: true,
    });
    // The new chapter mounts with pageInChapter=0; if we're stepping
    // backwards into the previous chapter, jump to its last page once
    // pagination remeasures. Tracked via a flag so the resize $effect
    // can apply it.
    pendingJumpToLast = opts.lastPage === true;
  }

  // Seeded from the cross-text "prev" handoff flag so the new
  // chapter mounts on its last page. The effect below applies the
  // jump once measurement finishes (pageCount > 0).
  let pendingJumpToLast = $state(untrack(() => startAtEndOfChapter));
  // SvelteKit reuses the page component across navigations between
  // /reader/<id> URLs — the $state initializer only fires once on
  // first mount, so a fresh `startAtEndOfChapter=true` prop arriving
  // via navigation wouldn't otherwise re-trigger the jump. This
  // effect re-arms `pendingJumpToLast` whenever the prop flips to
  // true AND forces a re-measure so the consumer effect below sees
  // the NEW chapter's pageCount rather than whatever was measured
  // for the previous chapter (otherwise we'd jump to the wrong page
  // and the clamp would push us to 0).
  $effect(() => {
    if (!startAtEndOfChapter) return;
    pendingJumpToLast = true;
    measure();
  });
  $effect(() => {
    if (!pendingJumpToLast) return;
    if (pageCount > 0) {
      pageInChapter = pageCount - 1;
      pendingJumpToLast = false;
    }
  });

  function nextPage() {
    if (hasNextPage) {
      pageInChapter += 1;
    } else if (hasNextChapter) {
      go(chapterIdx + 1);
    } else if (nextTextId) {
      // Walk off the end of this text — advance into the next text
      // in the containing collection. Keeps page mode active.
      void goto(`/reader/${nextTextId}?mode=page`, { keepFocus: true });
    }
  }
  function prevPage() {
    if (hasPrevPage) {
      pageInChapter -= 1;
    } else if (hasPrevChapter) {
      go(chapterIdx - 1, { lastPage: true });
    } else if (prevTextId) {
      // Stepping back off the start of this text lands on the LAST
      // page of the previous text — the reading-direction-natural
      // place to resume. The destination reader treats
      // `endOfChapter=1` as a URL anchor and jumps to the last page
      // of its last internal chapter after measurement.
      void goto(`/reader/${prevTextId}?mode=page&endOfChapter=1`, {
        keepFocus: true,
      });
    }
  }

  // T-5.7: ←/→ flip pages. Skip when typing in a form / textarea so
  // the popup's add-translation form keeps Enter/Esc behavior.
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
    if (e.key === 'ArrowLeft' && hasPrev) {
      e.preventDefault();
      prevPage();
    } else if (e.key === 'ArrowRight' && hasNext) {
      e.preventDefault();
      nextPage();
    }
  }

  // T-5.1c: swipe to flip pages on touch devices. The page-flip
  // arrows still work on mouse / keyboard / desktop touch; swipes
  // are an additional input. We track only the first finger
  // (`touches[0]`) so a pinch-zoom doesn't accidentally flip pages.
  let touchStart: { x: number; y: number } | null = null;
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      touchStart = null;
      return;
    }
    const t = e.touches[0]!;
    touchStart = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: TouchEvent) {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const swipe = classifySwipe(touchStart, { x: t.clientX, y: t.clientY });
    touchStart = null;
    if (swipe.direction === -1 && hasNext) nextPage();
    else if (swipe.direction === 1 && hasPrev) prevPage();
  }

  // Measure on mount + on resize / content change. ResizeObserver on
  // both the viewport (window resize, font-size change) and the
  // content (chapter toggle, romanization toggle changing line
  // height) keeps pageCount honest.
  //
  // Horizontal pagination wants column-width to equal one visible
  // column's width — i.e. the content element's own clientWidth.
  // Set it inline first so the browser knows to lay the chapter out
  // as side-by-side columns, then read scrollWidth (which forces a
  // layout flush) to get the resulting total span.
  function measure() {
    if (!viewportEl || !contentEl) return;
    const w = contentEl.clientWidth;
    if (w <= 0) return;
    contentEl.style.columnWidth = `${w}px`;
    // Reading scrollWidth flushes pending layout, so by the next
    // statement the column flow is committed.
    const total = contentEl.scrollWidth;
    pageW = w;
    contentW = total;
    columnIndexCache = null;
  }

  onMount(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    if (viewportEl) ro.observe(viewportEl);
    if (contentEl) ro.observe(contentEl);
    // Seed initial measurements before the observer fires.
    measure();
    return () => ro.disconnect();
  });

  // Re-measure when anything that mutates the content's natural size
  // changes — chapter, romanization toggle, or any of the typography
  // settings driven by CSS vars on the .reader root. ResizeObserver
  // fires on box-size changes only, so font-size / line-height swaps
  // (which only change scrollWidth) need an explicit nudge.
  //
  // `textId` + `chapters` are listed so a cross-text navigation
  // (chapter-book "prev"/"next" that swaps the whole chapter content
  // while leaving chapterIdx at 0) also re-measures. Without those
  // deps, contentW stayed at the OLD chapter's value and pageCount
  // was stale, so `pendingJumpToLast` jumped to the wrong page (or
  // got clamped back to 0).
  $effect(() => {
    void chapterIdx;
    void textId;
    void chapters;
    void showRomanization;
    void fontSize;
    void lineSpacing;
    void fontFamily;
    void readingWidth;
    measure();
  });

  function applyInitialTokenPage() {
    if (initialTokenApplied || !contentEl || pageW <= 0 || pageCount <= 0) return;
    if (initialTokenIdx <= 0) {
      restorePaintReady = true;
      initialTokenApplied = true;
      return;
    }
    const tokenEl = findTokenElementAtOrAfter(contentEl, initialTokenIdx);
    if (tokenEl) {
      pageInChapter = clampPage(columnIndexForElement(tokenEl, contentEl, pageW), pageCount);
    } else if (contentEl.querySelector(WORD_SELECTOR) == null) {
      // The chapter body hasn't laid down word spans yet — stay
      // masked and let the effect re-run when contentW/pageW settle
      // again. Marking applied now would strand the user on page 0.
      return;
    }
    initialTokenApplied = true;
    void tick().then(() => {
      window.requestAnimationFrame(() => {
        restorePaintReady = true;
      });
    });
  }

  function ensureColumnIndex(): PageWordIndex | null {
    if (!contentEl) return null;
    if (
      !columnIndexCache ||
      columnIndexCache.pageWidth !== pageW ||
      columnIndexCache.contentWidth !== contentW ||
      columnIndexCache.fallbackChapterIdx !== chapterIdx
    ) {
      columnIndexCache = buildPageWordIndex({
        root: contentEl,
        contentEl,
        pageWidth: pageW,
        contentWidth: contentW,
        fallbackChapterIdx: chapterIdx,
      });
    }
    return columnIndexCache;
  }

  function reportProgress() {
    if (!contentEl) return;
    // Don't fire while the viewport mask is up — the writer would
    // see an anchor for whatever pageInChapter happens to be before
    // applyInitialTokenPage jumps to the saved column, and on a
    // chapter change we'd briefly mirror tokenIdx=0 to the URL.
    if (isRestoringInitialToken) return;
    const index = ensureColumnIndex();
    if (!index) return;
    const anchor = firstWordInColumnFromIndex(index, pageInChapter);
    if (!anchor) return;
    const nextPageAnchor =
      pageInChapter < pageCount - 1
        ? firstWordInColumnFromIndex(index, pageInChapter + 1)
        : null;
    const boundary = pageBoundaryAnchor({
      chapters,
      chapterIdx,
      pageInChapter,
      pageCount,
      currentAnchor: anchor,
      nextAnchor: nextPageAnchor,
    });
    // Word-based progress using actual per-column word counts from
    // the DOM index. Each page contributes EXACTLY the words it
    // visibly carries, so a sparse page near the end moves the bar
    // a little and a dense page moves it a lot — matching what the
    // reader sees rather than assuming uniform distribution.
    //
    //   chapterDomTotal = words rendered in this chapter (all columns)
    //   beforePage      = words in columns < current
    //   throughPage     = words in columns <= current
    //   ratio           = chapter.tokenCount / chapterDomTotal
    //                     (scales DOM counts to the canonical
    //                      tokenCount so cross-chapter math stays
    //                      consistent with what other chapters
    //                      contribute when not in view)
    //   startWords      = wordsBeforeChapter + beforePage × ratio
    //   endWords        = wordsBeforeChapter + throughPage × ratio
    //
    // 100% is only hit on the last page of the last chapter.
    const totalWordsInText = chapters.reduce(
      (sum, c) => sum + Math.max(0, c.tokenCount),
      0,
    );
    const wordsBeforeChapter = chapters
      .slice(0, chapterIdx)
      .reduce((sum, c) => sum + Math.max(0, c.tokenCount), 0);
    const currentChapterWords = Math.max(
      0,
      chapters[chapterIdx]?.tokenCount ?? 0,
    );

    let domBeforePage = 0;
    let domThroughPage = 0;
    let domTotal = 0;
    for (const entry of index.entries) {
      domTotal += 1;
      if (entry.columnIndex < pageInChapter) domBeforePage += 1;
      if (entry.columnIndex <= pageInChapter) domThroughPage += 1;
    }
    const ratio = domTotal > 0 ? currentChapterWords / domTotal : 0;
    const startWords = wordsBeforeChapter + domBeforePage * ratio;
    const endWords = wordsBeforeChapter + domThroughPage * ratio;

    const startPctNext =
      totalWordsInText > 0 ? (startWords / totalWordsInText) * 100 : 0;
    const endPctNext = boundary.completed
      ? 100
      : totalWordsInText > 0
        ? (endWords / totalWordsInText) * 100
        : 0;
    startPct = startPctNext;
    endPct = endPctNext;
    if (!onProgress) return;
    // Resume position is the first word on this page; pctRead reports
    // how far the user has READ — i.e. the end-of-page boundary —
    // so the library card matches the reader footer.
    const next: ProgressAnchor = {
      ...anchor,
      pctRead: endPctNext,
    };
    const key = `${next.chapterIdx}:${next.tokenIdx}:${next.pctRead}`;
    if (key === lastReportedKey) return;
    lastReportedKey = key;
    onProgress(next);
  }

  $effect(() => {
    void initialTokenIdx;
    void pageCount;
    void pageW;
    void contentW;
    applyInitialTokenPage();
  });

  $effect(() => {
    void chapterIdx;
    void pageInChapter;
    void pageCount;
    void contentW;
    void pageW;
    void showRomanization;
    void fontSize;
    void lineSpacing;
    void fontFamily;
    void readingWidth;
    void tick().then(reportProgress);
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- T-5.1c: swipe gestures supplement the visible arrows + keyboard
     ←/→; role="region" appeases the static-element-interactions a11y
     check without claiming this div is the primary control. -->
<div
  class="reader-page-wrap"
  data-mode="page"
  role="region"
  aria-label="Reader pages"
  ontouchstart={onTouchStart}
  ontouchend={onTouchEnd}
>
  <button
    type="button"
    class="page-arrow page-arrow-l"
    data-step={prevLeavesChapter ? 'chapter' : 'page'}
    aria-label={prevLeavesChapter ? 'Previous chapter' : 'Previous page'}
    disabled={!hasPrev}
    onclick={prevPage}
  >
    <span class="arrow-glyph" aria-hidden="true">
      {#if prevLeavesChapter}
        <!-- Previous-chapter icon: left-pointing chevron + open
             book to its right. 24x24 viewBox; strokes inherit
             currentColor so the icon follows the button's text
             color in light/dark themes and the chapter-step
             accent state. -->
        <svg
          class="step-icon"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <!-- chevron pointing left, x=2..7 -->
          <path d="M7 7 L2 12 L7 17" />
          <!-- open book shifted right, x=13..23, leaving a ~6-unit
               gap between chevron and book so they don't crowd -->
          <path d="M13 18V8c0-1.1 1.2-2 3-2H18v10H16c-1.8 0-3 .9-3 2Z" />
          <path d="M18 18V8c0-1.1 1.2-2 3-2H23v10H21c-1.8 0-3 .9-3 2Z" />
        </svg>
      {:else}
        ‹
      {/if}
    </span>
  </button>

  <div class="reader-page-viewport">
    <div
      class="reader-page-window"
      bind:this={viewportEl}
      data-restoring={isRestoringInitialToken ? '1' : undefined}
    >
      <div
        class="reader-page-track"
        style:transform="translateX(-{offset}px)"
        data-restoring={isRestoringInitialToken ? '1' : undefined}
      >
        <div class="reader-page-content" bind:this={contentEl}>
          {#if current}
            {#if !titleInBody}
              <header class="chapter-h">
                {current.title ?? `Chapter ${current.idx + 1}`}
              </header>
            {/if}
            <article class:title-in-body={titleInBody}>
              <ChapterBody chapter={current} {language} {showRomanization} {isOwner} {isAdmin} />
            </article>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <button
    type="button"
    class="page-arrow page-arrow-r"
    data-step={nextLeavesChapter ? 'chapter' : 'page'}
    aria-label={nextLeavesChapter ? 'Next chapter' : 'Next page'}
    disabled={!hasNext}
    onclick={nextPage}
  >
    <span class="arrow-glyph" aria-hidden="true">
      {#if nextLeavesChapter}
        <!-- Next-chapter icon: open book on the left + a
             right-pointing chevron to its right. Mirror of the
             previous-chapter glyph. -->
        <svg
          class="step-icon"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <!-- open book on the left, x=1..11 -->
          <path d="M1 18V8c0-1.1 1.2-2 3-2H6v10H4c-1.8 0-3 .9-3 2Z" />
          <path d="M6 18V8c0-1.1 1.2-2 3-2H11v10H9c-1.8 0-3 .9-3 2Z" />
          <!-- chevron pointing right, x=17..22 — ~6-unit gap from
               the book so the two parts of the glyph are clearly
               separate rather than crowding into each other. -->
          <path d="M17 7 L22 12 L17 17" />
        </svg>
      {:else}
        ›
      {/if}
    </span>
  </button>
</div>

<footer class="reader-foot" aria-label="Chapter progress">
  <div class="reader-foot-meta">
    <span class="pager-pages">
      Page {pageInChapter + 1} of {pageCount}
      <span class="muted">· Ch. {counterCurrent} / {counterTotal}</span>
    </span>
    <span class="muted">{formatPctRange(startPct, endPct, pctPrecision)}</span>
  </div>
  <div class="reader-foot-bar">
    <i class="read" style="width: {startPct}%"></i>
    <i
      class="current"
      style="left: {startPct}%; width: {Math.max(0, endPct - startPct)}%"
    ></i>
  </div>
</footer>

<style>
  /* The page mode owns the available vertical space between the
     reader top bar and progress foot. The viewport is the fixed-
     height window; .reader-page-content is the (potentially much
     taller) chapter body that translates inside it.
     `flex: 1; min-height: 0` is the critical pair — without
     min-height:0 the viewport grows to fit the content (defeating
     the clip), without flex:1 it collapses to nothing. */
  .reader-page-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .reader-page-viewport {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 1.25rem 3rem;
    display: flex;
    justify-content: center;
  }
  @media (min-width: 1024px) {
    .reader-page-viewport {
      padding: 2rem 5rem;
    }
  }

  /* The "window" is the clipping mask. It fills the remaining width
     of the reader chrome (the rail is static on desktop, so the
     reader column already gets a sensible max width from the
     viewport - rail). Its overflow:hidden is what hides the off-page
     columns sitting to its right. The track inside (translateX
     target) carries the content, and the content's overflow extends
     past the window horizontally. */
  .reader-page-window {
    flex: 1;
    width: 100%;
    max-width: var(--reader-col-width, 40rem);
    height: 100%;
    overflow: hidden;
    position: relative;
  }
  .reader-page-window[data-restoring='1'] {
    opacity: 0;
  }

  /* The track is the transform target. We can't translateX a CSS
     multicolumn container directly — Blink renders fragmented column
     boxes and the transform is dropped — so the track wraps the
     content and slides it with the chapter's overflow following. */
  .reader-page-track {
    width: 100%;
    height: 100%;
    transition: transform 200ms ease;
    will-change: transform;
  }
  .reader-page-track[data-restoring='1'] {
    transition: none;
  }

  /* Horizontal pagination via CSS multi-column. The content element
     fills its parent window and `column-width` is set inline to that
     same width by `measure()`, so exactly one column is visible at a
     time and the browser auto-flows the chapter into however many
     columns the height allows. `column-fill: auto` keeps content
     packing into the current column to its full height before starting
     the next — without it the browser tries to balance columns, which
     short-circuits the pagination. */
  .reader-page-content {
    font-family: var(--reader-font-family, var(--font-serif-dev, var(--font-serif)));
    font-size: var(--reader-font-size, 1.1rem);
    line-height: var(--reader-line-height, 2);
    color: var(--ink, var(--color-fg));
    width: 100%;
    height: 100%;
    column-gap: 0;
    column-fill: auto;
    word-spacing: 0.03em;
    text-wrap: pretty;
  }

  .chapter-h {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    color: var(--ink-3, var(--color-fg-muted));
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--rule, var(--color-border));
    padding-bottom: 0.875rem;
    margin: 0 0 1.75rem;
    font-weight: 400;
  }
  /* When the chapter title lives inside the body (chapter-book
     uploads — see `createChapterBookCollection`), the body's first
     paragraph IS the title. Style it like a heading so the typography
     reads as "title above body" rather than two equal paragraphs.
     Words inside stay tokenized + clickable for lookup. The
     `:global()` reaches into ChapterBody's scoped CSS. */
  .title-in-body :global(.body:first-of-type) {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.35rem;
    line-height: 1.4;
    font-weight: 500;
    color: var(--ink, var(--color-fg));
    border-bottom: 1px solid var(--rule, var(--color-border));
    padding-bottom: 0.875rem;
    margin: 0 0 1.5rem;
  }

  /* Page arrows fill the full vertical strip on either side of the
     reader so the user can click anywhere in that column to flip
     pages — the round visual is just a hint. The viewport's padding
     keeps the body text from sliding under the strip. */
  .page-arrow {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3rem;
    background: transparent;
    border: 0;
    /* Use the full-contrast ink token so the chevron reads clearly
       on both light and dark surfaces. The muted token (--ink-2)
       was too low-contrast — at small sizes the glyph looked
       disabled even when the button was active. */
    color: var(--ink, var(--color-fg));
    display: grid;
    place-items: center;
    cursor: pointer;
    z-index: 8;
    padding: 0;
  }
  @media (min-width: 1024px) {
    .page-arrow {
      width: 5rem;
    }
  }
  .page-arrow-l {
    left: 0;
  }
  .page-arrow-r {
    right: 0;
  }
  .arrow-glyph {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    display: grid;
    place-items: center;
    font-size: 1.4rem;
    line-height: 1;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
    transition:
      background 150ms ease,
      color 150ms ease,
      transform 150ms ease;
  }
  /* Inline SVG glyph used for the chapter-step variant. Sits inside
     the round .arrow-glyph and inherits stroke=currentColor so it
     follows the parent's text color through theme + hover + accent
     states. */
  .step-icon {
    display: block;
  }
  .page-arrow:hover:not(:disabled) .arrow-glyph {
    /* Solid accent fill on hover — same for page and chapter-step
       buttons. The chapter-step variant signals itself purely
       through the open-book SVG glyph; styling otherwise stays
       identical so the buttons feel like the same control. The
       previous translucent `--accent-soft` overlay paired badly
       with `--accent-ink` (which expects a solid accent surface for
       WCAG contrast), making the hover state look disabled in dark
       mode. */
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-accent-fg, #fff));
    border-color: var(--accent, var(--color-accent));
    transform: scale(1.05);
  }
  .page-arrow:disabled {
    cursor: not-allowed;
  }
  .page-arrow:disabled .arrow-glyph {
    opacity: 0.25;
  }

  .reader-foot {
    border-top: 1px solid var(--rule, var(--color-border));
    background: color-mix(in oklch, var(--paper, var(--color-bg)) 88%, var(--paper-2, transparent));
    padding: 0.6rem 1.25rem 0.75rem;
    position: sticky;
    bottom: 0;
  }
  @media (min-width: 768px) {
    .reader-foot {
      padding: 0.75rem 1.75rem 0.9rem;
    }
  }
  .reader-foot-meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin-bottom: 0.4rem;
  }
  .pager-pages {
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
    letter-spacing: 0.04em;
    color: var(--ink-2, var(--color-fg));
  }
  .muted {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .reader-foot-bar {
    height: 3px;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 8%, transparent);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }
  .reader-foot-bar > i {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 2px;
    transition:
      width 250ms ease,
      left 250ms ease;
  }
  /* Words read before the current page — muted accent so the eye
     reads it as "behind me" rather than "active". */
  .reader-foot-bar > i.read {
    left: 0;
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 45%, transparent);
  }
  /* Words on the current page — full-strength accent so the active
     range stands out as the "you are here" segment. */
  .reader-foot-bar > i.current {
    background: var(--accent, var(--color-accent));
  }

  /* Respect reduced-motion: skip the page-flip slide. */
  @media (prefers-reduced-motion: reduce) {
    .reader-page-track {
      transition: none;
    }
  }
</style>
