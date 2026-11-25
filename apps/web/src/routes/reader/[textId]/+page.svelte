<script lang="ts">
  import { hindiReviewHref } from '$lib/dictionary/hindi-review-link';
  import { page } from '$app/state';
  import Button from '$lib/components/input/Button.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, setContext, untrack } from 'svelte';

  import AlignmentHighlighter from '$lib/components/reader/AlignmentHighlighter.svelte';
  import AudioPlayer from '$lib/components/reader/AudioPlayer.svelte';
  import ChapterNav from '$lib/components/reader/ChapterNav.svelte';
  import ReaderContinuous from '$lib/components/reader/ReaderContinuous.svelte';
  import ReaderImage from '$lib/components/reader/ReaderImage.svelte';
  import ReaderPage from '$lib/components/reader/ReaderPage.svelte';
  import ReaderScroll from '$lib/components/reader/ReaderScroll.svelte';
  import PageCloseLink from '$lib/components/shell/PageCloseLink.svelte';
  import { reprocessWithToast } from '$lib/text/reprocess.js';
  import { getToastStore } from '$lib/components/toast/toast-store.js';
  import { readerOccurrenceIgnores } from '$lib/components/reader/ignored-occurrences';
  import ReaderSettings from '$lib/components/reader/ReaderSettings.svelte';
  import { ProgressWriter, type ProgressAnchor } from '$lib/components/reader/progress-client.js';
  import { computePctRead } from '$lib/components/reader/reader-progress.js';
  import { buildReaderAnchorUrl } from '$lib/components/reader/url-anchor.js';
  import { buildReaderToc } from '$lib/components/reader/reader-toc.js';
  import {
    readPersistedFlagUndefined,
    setFlagUndefinedAttribute,
    writePersistedFlagUndefined,
  } from '$lib/components/reader/undefined-highlight.js';
  import {
    READING_WIDTH_REM,
    type ReaderSettings as ReaderSettingsT,
  } from '$lib/components/reader/reader-settings.js';
  import { LANGUAGES, type LanguageCode } from '@ciareader/shared-types';
  import type { PageProps } from './$types';
  import ReadingBookmark from './ReadingBookmark.svelte';

  const toastStore = getToastStore();
  readerOccurrenceIgnores();

  let { data }: PageProps = $props();

  setContext('readerDictionary', () => data.dictionaryEditor);

  // PDF texts render as a page-image reader (clickable word overlays)
  // regardless of the saved layout mode.
  const usesPageImages = $derived(data.text.sourceType === 'pdf' || !!data.chapters[data.anchor.chapterIdx]?.pageImageUrl);

  // Live status mirrors data.text.status; flips when the polling loop
  // hits a terminal state.
  let liveStatus = $state(untrack(() => data.text.status));
  let liveError = $state<string | null>(null);

  // Romanization is a pure render flag — the token rows already carry
  // romanizations, the toggle just decides whether to render
  // <ruby> spans. Keeping it as local client state means the toggle
  // doesn't reload the page (no scroll-to-top, no chapter re-fetch).
  // Initial value still comes from the URL so a deep link with
  // `?roman=1` opens with romanization on.
  let showRomanization = $state(untrack(() => data.showRomanization));
  // Re-sync if the loader hands us a new initial value (e.g. user
  // navigated to a different text that has its own URL state).
  $effect(() => {
    showRomanization = data.showRomanization;
  });
  // Romanization only applies to non-Latin scripts. Basque (Latin) has
  // no romanization layer, so the registry lists no schemes — hide the
  // toggle entirely there, mirroring how ReaderSettings hides the
  // scheme picker.
  const canRomanize = $derived(
    (LANGUAGES[data.text.language as LanguageCode]?.supportedRomanizations.length ?? 0) > 0,
  );

  // live reader settings. Seeded from the server-loaded
  // user_languages row; the popover updates this state on every
  // interaction (live preview) and PATCHes the row in the background.
  let readerSettings = $state<ReaderSettingsT>(untrack(() => data.readerSettings));
  $effect(() => {
    readerSettings = data.readerSettings;
  });
  let settingsOpen = $state(false);
  const mobileArrowsKey = 'reader.hideMobilePageArrows';
  let hideMobileArrows = $state(false);

  function setMobileArrowsHidden(hidden: boolean) {
    hideMobileArrows = hidden;
    document.documentElement.toggleAttribute('data-hide-mobile-page-arrows', hidden);
    try {
      if (hidden) localStorage.setItem(mobileArrowsKey, '1');
      else localStorage.removeItem(mobileArrowsKey);
    } catch {
      // The preference still applies for this visit when storage is unavailable.
    }
  }

  let flagUndefined = $state(false);
  function setFlagUndefined(on: boolean) {
    flagUndefined = on;
    writePersistedFlagUndefined(on);
  }

  let mounted = $state(false);
  let processingId = $state<string | null>(null);
  const reprocessing = $derived(processingId === data.text.id);
  let continuousRevision = $state(0);

  async function reprocessText() {
    if (processingId) return;
    const { id } = data.text;
    processingId = id;
    try {
      await reprocessWithToast(data.text, toastStore);
      if (data.text.id === id) {
        await invalidateAll();
        if (data.text.id === id) {
          liveStatus = data.text.status;
          liveError = data.text.statusError;
          continuousRevision++;
        }
      }
    } catch {
      toastStore.pushToast({ kind: 'error', message: 'Could not refresh the reader.' });
    } finally {
      processingId = null;
    }
  }

  // CSS-variable string applied to the reader root so every reader
  // mode picks up the setting without each one having to know about
  // every CSS variable. Keeping the math in JS lets the popover's
  // live-preview path skip a layout-thrashing class swap.
  const readerStyle = $derived(
    [
      `--reader-font-size: ${readerSettings.fontSize}pt`,
      `--reader-line-height: ${readerSettings.lineSpacing}`,
      `--reader-col-width: ${READING_WIDTH_REM[readerSettings.readingWidth]}rem`,
      readerSettings.fontFamily
        ? `--reader-font-family: '${readerSettings.fontFamily.replace(/'/g, "\\'")}'`
        : '',
    ]
      .filter(Boolean)
      .join('; '),
  );

  // Set the preference on the document so the same styles reach words in every reader layout.
  $effect(() => {
    if (typeof document === 'undefined') return;
    setFlagUndefinedAttribute(data.isAdmin && flagUndefined);
    return () => setFlagUndefinedAttribute(false);
  });

  function anchorFromData(): ProgressAnchor {
    return {
      chapterIdx: data.anchor.chapterIdx,
      tokenIdx: data.anchor.tokenIdx,
      pctRead: computePctRead(data.chapters, data.anchor.chapterIdx, data.anchor.tokenIdx),
    };
  }

  let currentProgressAnchor = $derived(anchorFromData());
  const bookmarkBookId = $derived(data.collectionContext?.collectionKind === 'chapter_book'
    ? data.collectionContext.collectionId : data.text.id);
  const bookmarkKey = $derived(`reader.bookmark:${data.user?.id ?? 'guest'}:${bookmarkBookId}`);

  const reviewReaderUrl = $derived(new URL(buildReaderAnchorUrl(page.url.href, {
    mode: data.mode,
    chapterIdx: currentProgressAnchor.chapterIdx,
    tokenIdx: currentProgressAnchor.tokenIdx,
    showRomanization,
  })));

  // Chapter table-of-contents model — drives the shared chapter
  // selector dropdown + the page footer's whole-book progress. Handles
  // both layouts uniformly: multi-chapter texts (jump via ?chapter=N)
  // and chapter-books (each chapter is its own text, jump via textId).
  const toc = $derived(
    buildReaderToc({
      textId: data.text.id,
      mode: data.mode,
      chapters: data.chapters.map((c) => ({
        idx: c.idx,
        title: c.title,
        tokenCount: c.tokenCount,
      })),
      currentChapterIdx: currentProgressAnchor.chapterIdx,
      collection: data.collectionContext
        ? {
            chapters: data.collectionContext.chapters,
            position: data.collectionContext.position,
          }
        : null,
    }),
  );

  function shouldPoll(s: typeof data.text.status): boolean {
    return s === 'pending' || s === 'processing';
  }

  const statusLabel = $derived(
    {
      pending: 'Waiting to be processed',
      processing: 'Processing — please wait',
      ready: 'Ready',
      failed: 'Processing failed',
    }[liveStatus] ?? liveStatus,
  );

  function mirrorAnchorToUrl(anchor: ProgressAnchor) {
    const next = buildReaderAnchorUrl(window.location.href, {
      mode: data.mode,
      chapterIdx: anchor.chapterIdx,
      tokenIdx: anchor.tokenIdx,
      showRomanization,
    });
    if (next !== window.location.href) {
      window.history.replaceState(window.history.state, '', next);
    }
  }

  function onReaderProgress(anchor: ProgressAnchor) {
    currentProgressAnchor = anchor;
    mirrorAnchorToUrl(anchor);
    progressWriter?.schedule(anchor);
  }

  function setMode(mode: 'page' | 'paged_scroll' | 'continuous') {
    // Snapshot the anchor synchronously so a late `reportProgress`
    // can't change it between flush and goto. Use the keepalive
    // path so the navigation that follows can't cancel the PATCH.
    const anchor = currentProgressAnchor;
    if (progressWriter) {
      progressWriter.schedule(anchor);
      void progressWriter.flush();
    }
    const params = new URLSearchParams();
    params.set('mode', mode);
    params.set('chapter', String(anchor.chapterIdx));
    params.set('token', String(anchor.tokenIdx));
    if (showRomanization) params.set('roman', '1');
    void goto(`/reader/${data.text.id}?${params.toString()}`, {
      keepFocus: true,
    });
  }

  function setRomanization(show: boolean) {
    showRomanization = show;
    // Mirror the new state into the URL so a refresh / share keeps
    // the toggle on, but `replaceState: true` + `noScroll: true`
    // means the address bar updates in place — no rerun of the
    // loader, no chapter refetch, no scroll jump.
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (showRomanization) url.searchParams.set('roman', '1');
    else url.searchParams.delete('roman');
    window.history.replaceState(window.history.state, '', url.toString());
  }

  // Only signed-in readers have an account in which to save progress.
  const progressTextId = $derived(data.canPersistSettings ? data.text.id : null);
  const progressWriter = $derived(progressTextId ? new ProgressWriter(progressTextId) : null);

  // The reader's top bar is a full-width fixed element. We measure
  // its height into a `--reader-top-h` CSS variable so the AppShell
  // rail and the reader body can both leave room for it without
  // baking a fixed pixel value into either component.
  let readerTopEl: HTMLElement | null = $state(null);

  // Only a mounted reader counts as an open. Library link preloads run the server loader.
  let recordedOpen = '';
  $effect(() => {
    const id = data.text.id;
    if (data.canPersistSettings && id !== recordedOpen) {
      recordedOpen = id;
      void fetch(`/api/v1/me/text-progress/${id}`, { method: 'POST', keepalive: true })
        .catch(() => {});
    }
  });

  onMount(() => {
    mounted = true;
    liveStatus = data.text.status;
    hideMobileArrows = document.documentElement.hasAttribute('data-hide-mobile-page-arrows');

    if (data.isAdmin) flagUndefined = readPersistedFlagUndefined();

    const refreshMerge = async () => {
      await invalidateAll();
      continuousRevision++;
    };
    window.addEventListener('reader-words-merged', refreshMerge);

    // Status polling — owners only.
    let cleanupPoll: (() => void) | null = null;
    if (data.isOwner && shouldPoll(liveStatus)) {
      const interval = window.setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/texts/${data.text.id}/status`);
          if (!res.ok) return;
          const payload = (await res.json()) as {
            status: typeof data.text.status;
            statusError: string | null;
          };
          liveStatus = payload.status;
          liveError = payload.statusError;
          if (!shouldPoll(payload.status)) {
            window.clearInterval(interval);
            await invalidateAll();
          }
        } catch {
          // Quiet retry on the next tick.
        }
      }, 2500);
      cleanupPoll = () => window.clearInterval(interval);
    }

    // Track the .reader-top height so the rail can sit below it.
    let topRO: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && readerTopEl) {
      const apply = () => {
        if (!readerTopEl) return;
        const h = readerTopEl.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--reader-top-h', `${h}px`);
      };
      topRO = new ResizeObserver(apply);
      topRO.observe(readerTopEl);
      apply();
    }

    return () => {
      cleanupPoll?.();
      window.removeEventListener('reader-words-merged', refreshMerge);
      topRO?.disconnect();
      document.documentElement.style.removeProperty('--reader-top-h');
    };
  });

  $effect(() => {
    const writer = progressWriter;
    if (!writer) return;
    const flush = () => { void writer.flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
    };
  });
</script>

<svelte:head>
  <title>{data.text.title} | Parhiba</title>
</svelte:head>

{#snippet processButton()}
  {#if data.isAdmin || (data.isOwner && liveStatus === 'failed')}
        <button
          type="button"
          class="reprocess-toggle"
          onclick={reprocessText}
          disabled={!mounted || !!processingId}
          title={data.isAdmin
            ? 'Re-run the NLP pipeline on this text (admin)'
            : 'Retry processing this text'}
          data-testid={data.isAdmin ? 'admin-reprocess' : 'owner-retry'}
        >
          {reprocessing
            ? data.isAdmin
              ? 'Reprocessing…'
              : 'Retrying…'
            : data.isAdmin
              ? 'Reprocess'
              : 'Retry'}
        </button>
  {/if}
{/snippet}

{#snippet mobileChapterPicker()}
  <div class="mobile-picker">
    <ChapterNav entries={toc.entries} currentIndex={toc.currentIndex} footer />
  </div>
{/snippet}

<div
  class="reader"
  data-mode={usesPageImages ? 'pdf' : data.mode}
  data-hl={readerSettings.highlightStyle}
  data-highlight-learning={readerSettings.highlightLearning ? 'on' : 'off'}
  style={readerStyle}
>
  <header class="reader-top" bind:this={readerTopEl}>
    <div class="reader-top-left">
      <PageCloseLink href="/library" label="Close reader" />
      {#if data.collectionContext}
        <a
          class="reader-book"
          href={`/collections/${data.collectionContext.collectionId}`}
          title={data.collectionContext.collectionTitle}
        >
          {data.collectionContext.collectionTitle}
        </a>
      {:else}
        <span class="reader-book reader-book-static" title={data.text.title}>
          {data.text.title}
        </span>
      {/if}
    </div>

    <div class="reader-top-center" class:has-status={liveStatus !== 'ready'}>
      {#if toc.entries.length > 1}
        <ChapterNav
          entries={toc.entries}
          currentIndex={toc.currentIndex}
          nextLocked={data.collectionContext?.nextLocked ?? false}
        />
      {/if}
      {#if liveStatus !== 'ready'}
        <span
          class="reader-status reader-status-{liveStatus}"
          role={liveStatus === 'failed' ? 'alert' : 'status'}
        >
          {statusLabel}
        </span>
      {/if}
    </div>

    <div class="reader-tools">
      {#if canRomanize}
        <button
          type="button"
          class="roman-toggle"
          data-active={showRomanization ? '1' : '0'}
          onclick={() => setRomanization(!showRomanization)}
          aria-pressed={showRomanization}
          title="Toggle romanization"
        >
          Aa
        </button>
      {/if}

      <span class="desktop-tools">{@render processButton()}</span>

      {#if data.chapters.length > 0}
        {#key bookmarkKey}
          <ReadingBookmark storageKey={bookmarkKey} mode={data.mode} {showRomanization}
            position={{ textId: data.text.id, chapterIdx: currentProgressAnchor.chapterIdx, tokenIdx: currentProgressAnchor.tokenIdx }} />
        {/key}
      {/if}

      <button
        type="button"
        class="settings-toggle"
        onclick={() => (settingsOpen = !settingsOpen)}
        aria-label="Reader settings"
        aria-expanded={settingsOpen}
        title="Reader settings"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>

    </div>
  </header>

  {#if liveStatus === 'failed' && liveError}
    <p class="err" role="alert">Processing error: {liveError}</p>
  {/if}

  {#if usesPageImages}
    <ReaderImage
      chapters={data.chapters}
      chapterIdx={data.anchor.chapterIdx}
      textId={data.text.id}
      language={data.text.language as LanguageCode}
      {showRomanization}
      isOwner={data.isOwner}
      isAdmin={data.isAdmin}
      onProgress={onReaderProgress}
    />
  {:else if data.mode === 'page'}
    <ReaderPage
      {settingsOpen}
      chapterPicker={toc.entries.length > 1 ? mobileChapterPicker : undefined}
      chapters={data.chapters}
      chapterIdx={data.anchor.chapterIdx}
      initialTokenIdx={data.anchor.tokenIdx}
      textId={data.text.id}
      language={data.text.language as LanguageCode}
      {showRomanization}
      isOwner={data.isOwner}
      isAdmin={data.isAdmin}
      onProgress={onReaderProgress}
      fontSize={readerSettings.fontSize}
      lineSpacing={readerSettings.lineSpacing}
      fontFamily={readerSettings.fontFamily}
      readingWidth={readerSettings.readingWidth}
      prevTextId={data.collectionContext?.prevTextId ?? null}
      nextTextId={data.collectionContext?.nextTextId ?? null}
      collectionPosition={data.collectionContext?.position ?? null}
      collectionTotal={data.collectionContext?.totalCount ?? null}
      bookWordsBefore={toc.bookWordsBefore}
      bookWordsTotal={toc.bookWordsTotal}
      startAtEndOfChapter={data.anchor.endOfChapter ?? false}
    />
  {:else if data.mode === 'paged_scroll'}
    <ReaderScroll
      chapters={data.chapters}
      chapterIdx={data.anchor.chapterIdx}
      initialTokenIdx={data.anchor.tokenIdx}
      wordsPerPage={readerSettings.wordsPerPage}
      textId={data.text.id}
      language={data.text.language as LanguageCode}
      {showRomanization}
      isOwner={data.isOwner}
      isAdmin={data.isAdmin}
      onProgress={onReaderProgress}
    />
  {:else}
    {#key continuousRevision}
      <ReaderContinuous
        chapters={data.chapters}
        initialChapterIdx={data.anchor.chapterIdx}
        initialTokenIdx={data.anchor.tokenIdx}
        textId={data.text.id}
        language={data.text.language as LanguageCode}
        {showRomanization}
        isOwner={data.isOwner}
        isAdmin={data.isAdmin}
        onProgress={onReaderProgress}
      />
    {/key}
  {/if}

  {#if (usesPageImages || data.mode !== 'page') && toc.entries.length > 1}
    <footer class="mobile-chapter-footer" aria-label="Chapter navigation">{@render mobileChapterPicker()}</footer>
  {/if}
  {#if data.audio}
    <AudioPlayer audio={data.audio} canRecordListening={data.canPersistSettings} />
    <AlignmentHighlighter />
  {/if}
</div>

<ReaderSettings
  open={settingsOpen}
  onClose={() => (settingsOpen = false)}
  language={data.text.language as LanguageCode}
  settings={readerSettings}
  onChange={(next) => {
    if (next.readerLayoutMode !== readerSettings.readerLayoutMode && next.readerLayoutMode !== data.mode) {
      setMode(next.readerLayoutMode);
    }
    readerSettings = next;
  }}
  canPersist={data.canPersistSettings}
  isAdmin={data.isAdmin}
  {showRomanization}
  onRomanizationChange={setRomanization}
  {hideMobileArrows}
  onMobileArrowsChange={usesPageImages || data.mode !== 'continuous' ? setMobileArrowsHidden : undefined}
  {flagUndefined}
  onFlagUndefinedChange={setFlagUndefined}
>
  {#snippet processingTools()}
    {#if data.canReviewHindi}
      <Button href={hindiReviewHref(reviewReaderUrl, data.text.id)}>Review dictionary matches</Button>
    {/if}
    {#if data.isAdmin || (data.isOwner && liveStatus === 'failed')}
      <section class="mobile-processing">
        <h3>Text processing</h3>
        {@render processButton()}
      </section>
    {/if}
  {/snippet}
</ReaderSettings>

<style>
  /* CIAR design reader chrome. Paper background + serif title.
     Stacks on small viewports; romanization + settings sit on the
     right at >=640px. */
  .reader {
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    /* Fill the AppShell's content track so page mode can occupy the
       full vertical space. Children flex-stack vertically:
       sticky top bar, fluid body, and progress foot. */
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  /* The word side-panel is a permanent right column on desktop. Pad
     the reader so its chapter, header, and progress strip never run
     behind it. The panel width comes from Sheet's --sheet-width
     (default 380px). */
  @media (min-width: 960px) {
    .reader {
      padding-right: 380px;
    }
  }
  /* Page mode is meant to behave like a book — no vertical scroll;
     overflow stays inside the viewport, page arrows step through it. */
  .reader[data-mode='page'] {
    height: 100svh;
    min-height: 0;
    overflow: clip;
  }
  :global(html:has(.reader[data-mode='page'])) {
    overflow-y: auto;
    overscroll-behavior-x: none;
  }
  :global(body:has(.reader[data-mode='page'])) {
    height: 100svh;
    min-height: 0;
    overflow: clip;
  }
  /* The top bar lives inside the reader's right column (sticky inside
     the AppShell content track, not over the rail). The right side
     panel reads `--reader-top-h` to anchor below it. */
  .reader-top {
    position: sticky;
    top: 0;
    /* Above the body's page-flip arrows (z-index 8) so the chapter TOC
       dropdown — which lives in this sticky header's stacking context —
       overlays them. Stays below the overlay sheets (z-index 40) so a
       mobile word/settings sheet still covers the header. */
    z-index: 10;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem 1rem;
    padding: 0.85rem 1.25rem 0.9rem;
    background: color-mix(in oklch, var(--paper, var(--color-bg)) 86%, var(--paper-2, transparent));
    border-bottom: 1px solid var(--rule, var(--color-border));
  }
  @media (min-width: 640px) {
    .reader-top {
      grid-template-columns: auto 1fr auto;
      align-items: center;
      padding: 1rem 1.75rem;
    }
  }
  /* The side panel anchors BELOW the header (top: --reader-top-h), so
     the header spans the full width. Cancel the reader's side-panel
     padding here so the right-aligned tools reach the true right edge
     instead of stopping at the panel's left boundary. */
  @media (min-width: 960px) {
    .reader-top {
      margin-right: -380px;
      /* Desktop shows the word panel as a static column (z-index 40).
         Lift the header above it so the chapter TOC dropdown clears the
         panel on narrower desktop widths where it would otherwise be
         occluded. The panel is non-dimmed here, so the header sitting
         above it is fine. */
      z-index: 41;
    }
  }
  .reader-top-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  /* Book / collection title on the left — links to the collection page
     when this text is a chapter of one, otherwise a plain label. */
  .reader-book {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--ink-2, var(--color-fg));
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: min(40vw, 18rem);
  }
  a.reader-book:hover {
    color: var(--ink, var(--color-fg));
    text-decoration: underline;
  }
  .reader-book-static {
    color: var(--ink, var(--color-fg));
  }
  .reader-top-center {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    min-width: 0;
  }
  /* Processing / failed shown as plain inline text (no pill). */
  .reader-status {
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.72rem;
    white-space: nowrap;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .reader-status-processing,
  .reader-status-pending {
    color: var(--accent-ink, #b07a31);
  }
  .reader-status-failed {
    color: var(--rose, #b03131);
  }
  .reader-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  /* Settings gear is a plain icon button — no border, no fill, just the
     same muted ink as the other tools, with a subtle hover. */
  .settings-toggle {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-2, var(--color-fg-muted));
    cursor: pointer;
  }
  .settings-toggle:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    color: var(--ink, var(--color-fg));
  }
  .roman-toggle {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: transparent;
    color: var(--ink-2, var(--color-fg-muted));
    font-family: var(--font-serif, serif);
    font-size: 0.85rem;
    cursor: pointer;
  }
  .roman-toggle[data-active='1'] {
    background: var(--accent-soft, var(--color-accent));
    border-color: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-accent-fg, #fff));
  }
  .reprocess-toggle {
    height: 32px;
    padding: 0 0.7rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: transparent;
    color: var(--ink-2, var(--color-fg-muted));
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .reprocess-toggle:hover:not([disabled]) {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 5%, transparent);
    color: var(--ink, var(--color-fg));
  }
  .reprocess-toggle[disabled] {
    opacity: 0.55;
    cursor: progress;
  }
  .err {
    color: var(--rose, #b03131);
    background: var(--rose-soft, color-mix(in srgb, #b03131 8%, transparent));
    border: 1px solid color-mix(in srgb, #b03131 30%, transparent);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin: 1rem 1.25rem 0;
  }
  .mobile-picker, .mobile-chapter-footer, .mobile-processing { display: none; }
  @media (max-width: 639px) {
    .reader :global(.reader-scroll-inner) { touch-action: pan-y pinch-zoom; }
    :global(html[data-hide-mobile-page-arrows]) .reader :global(.page-arrow) { display: none; }
    :global(html[data-hide-mobile-page-arrows]) .reader :global(.reader-page-viewport),
    :global(html[data-hide-mobile-page-arrows]) .reader :global(.reader-scroll-inner),
    :global(html[data-hide-mobile-page-arrows]) .reader :global(.reader-image .page-body) {
      padding-left: max(0.75rem, env(safe-area-inset-left));
      padding-right: max(0.75rem, env(safe-area-inset-right));
    }
    .reader-top { grid-template-columns: minmax(0, 1fr) auto; align-items: center; padding: .25rem .75rem; }
    .settings-toggle { width: 44px; height: 44px; }
    .reader-book { max-width: none; }
    .reader-top-center, .reader-top-center :global(.chapter-nav), .roman-toggle, .desktop-tools { display: none; }
    .reader-top-center.has-status { display: flex; grid-column: 1 / -1; grid-row: 2; justify-content: start; }
    .mobile-picker, .mobile-processing { display: block; }
    .mobile-chapter-footer {
      position: sticky; bottom: 0; z-index: 9; display: flex; justify-content: flex-end;
      padding: 0 .75rem env(safe-area-inset-bottom, 0px); background: var(--paper); border-top: 1px solid var(--rule);
    }
  }
</style>
