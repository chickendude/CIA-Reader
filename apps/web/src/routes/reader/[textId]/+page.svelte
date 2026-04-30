<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, untrack } from 'svelte';

  import AlignmentHighlighter from '$lib/components/reader/AlignmentHighlighter.svelte';
  import AudioPlayer from '$lib/components/reader/AudioPlayer.svelte';
  import ReaderContinuous from '$lib/components/reader/ReaderContinuous.svelte';
  import ReaderPage from '$lib/components/reader/ReaderPage.svelte';
  import ReaderScroll from '$lib/components/reader/ReaderScroll.svelte';
  import ReaderSettings from '$lib/components/reader/ReaderSettings.svelte';
  import { ProgressWriter, type ProgressAnchor } from '$lib/components/reader/progress-client.js';
  import { computePctRead } from '$lib/components/reader/reader-progress.js';
  import {
    isImmersiveAttributeSet,
    setImmersiveAttribute,
    writePersistedImmersive,
  } from '$lib/components/reader/immersive.js';
  import {
    READING_WIDTH_REM,
    type ReaderSettings as ReaderSettingsT,
  } from '$lib/components/reader/reader-settings.js';
  import type { LanguageCode } from '@ciareader/shared-types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // T-5.16: Immersive mode hides the AppShell rail / bottom-nav so
  // the reader takes the full viewport. T-5.26 moved the actual
  // toggle to the AppShell hamburger button — the reader page only
  // owns the Esc-to-exit shortcut here. The cross-route cleanup also
  // moved into AppShell, since the rail-toggle is now global.

  // Live status mirrors data.text.status; flips when the polling loop
  // hits a terminal state (T-4.4).
  let liveStatus = $state(untrack(() => data.text.status));
  let liveError = $state<string | null>(null);

  // Romanization is a pure render flag — the token rows already carry
  // romanizations (T-2.5), the toggle just decides whether to render
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

  // T-5.1b: live reader settings. Seeded from the server-loaded
  // user_languages row; the popover updates this state on every
  // interaction (live preview) and PATCHes the row in the background.
  let readerSettings = $state<ReaderSettingsT>(untrack(() => data.readerSettings));
  $effect(() => {
    readerSettings = data.readerSettings;
  });
  let settingsOpen = $state(false);

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

  // tokens.css scopes the word-status highlight rules to
  // `html[data-hl='…']` (set up-front by app.html so first paint is
  // correct). Mirror the popover's choice onto <html> so a live change
  // flips the rules immediately. The previous value is restored on
  // unmount so the attribute reflects this language's setting only
  // while the reader is on screen.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const previous = html.getAttribute('data-hl');
    html.setAttribute('data-hl', readerSettings.highlightStyle);
    return () => {
      if (previous == null) html.removeAttribute('data-hl');
      else html.setAttribute('data-hl', previous);
    };
  });

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

  function anchorFromData(): ProgressAnchor {
    return {
      chapterIdx: data.anchor.chapterIdx,
      tokenIdx: data.anchor.tokenIdx,
      pctRead: computePctRead(data.chapters, data.anchor.chapterIdx, data.anchor.tokenIdx),
    };
  }

  let currentProgressAnchor = $state<ProgressAnchor>(untrack(anchorFromData));
  let lastUrlAnchorKey = '';

  function mirrorAnchorToUrl(anchor: ProgressAnchor) {
    if (typeof window === 'undefined') return;
    const key = `${data.mode}:${anchor.chapterIdx}:${anchor.tokenIdx}:${showRomanization ? 1 : 0}`;
    if (key === lastUrlAnchorKey) return;
    lastUrlAnchorKey = key;
    const url = new URL(window.location.href);
    url.searchParams.set('mode', data.mode);
    url.searchParams.set('chapter', String(anchor.chapterIdx));
    url.searchParams.set('token', String(anchor.tokenIdx));
    if (showRomanization) url.searchParams.set('roman', '1');
    else url.searchParams.delete('roman');
    window.history.replaceState(window.history.state, '', url.toString());
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
      void progressWriter.flush({ keepalive: true });
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

  function toggleRomanization() {
    showRomanization = !showRomanization;
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

  // T-5.6 progress writer. Signed-in readers get one; anonymous
  // viewers of an official text don't have a row to write against.
  let progressWriter: ProgressWriter | null = null;
  let pageHideHandler: (() => void) | null = null;
  let visibilityHandler: (() => void) | null = null;

  // The reader's top bar is a full-width fixed element. We measure
  // its height into a `--reader-top-h` CSS variable so the AppShell
  // rail and the reader body can both leave room for it without
  // baking a fixed pixel value into either component.
  let readerTopEl: HTMLElement | null = $state(null);

  onMount(() => {
    liveStatus = data.text.status;

    // T-5.26: AppShell hydrates the immersive flag now. The reader
    // only owns the Esc-to-exit shortcut — quick way out of
    // full-screen reading without hunting for the hamburger button.
    // We skip Esc when the word side-panel is open since the popup
    // owns that key.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!isImmersiveAttributeSet()) return;
      if (document.querySelector('[data-testid="word-popup"]')) return;
      e.preventDefault();
      setImmersiveAttribute(false);
      writePersistedImmersive(false);
    };
    window.addEventListener('keydown', onKey);

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

    // T-7.7: progress writer for any signed-in reader, not just
    // owners. user_text_progress is keyed on (user, text) so a
    // recipient of a shared text or a signed-in reader of an
    // official text gets their own resume-anchor row. Anonymous
    // viewers (the only false branch of canPersistSettings) skip.
    if (data.canPersistSettings) {
      progressWriter = new ProgressWriter(data.text.id);
      currentProgressAnchor = anchorFromData();
      // Flush on refresh / tab close through the keepalive path so
      // the latest debounced anchor survives the navigation. iOS
      // Safari doesn't reliably fire `pagehide` when the tab is
      // backgrounded — `visibilitychange → hidden` is the more
      // dependable hook there, so we wire both.
      const flushKeepalive = () => {
        void progressWriter?.flush({ keepalive: true });
      };
      pageHideHandler = flushKeepalive;
      visibilityHandler = () => {
        if (document.visibilityState === 'hidden') flushKeepalive();
      };
      window.addEventListener('pagehide', pageHideHandler);
      document.addEventListener('visibilitychange', visibilityHandler);
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
      window.removeEventListener('keydown', onKey);
      if (pageHideHandler) window.removeEventListener('pagehide', pageHideHandler);
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
      void progressWriter?.flush();
      topRO?.disconnect();
      document.documentElement.style.removeProperty('--reader-top-h');
    };
  });

  // Watch URL anchor changes so mode switches and fresh loads start
  // from the loader's anchor locally. We deliberately don't write it
  // back immediately; the active reader mode reports the actual
  // first visible word once it has restored layout.
  $effect(() => {
    const anchor = anchorFromData();
    currentProgressAnchor = anchor;
    lastUrlAnchorKey = `${data.mode}:${anchor.chapterIdx}:${anchor.tokenIdx}:${showRomanization ? 1 : 0}`;
  });
</script>

<svelte:head>
  <title>{data.text.title} — CIA Reader</title>
</svelte:head>

<div class="reader" data-mode={data.mode} style={readerStyle}>
  <header class="reader-top" bind:this={readerTopEl}>
    <a class="reader-close" href="/library" aria-label="Close reader" title="Close reader">
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12" />
        <path d="M18 6L6 18" />
      </svg>
    </a>
    <div class="reader-meta">
      {#if data.collectionContext}
        <p class="reader-coll-strip">
          <a class="reader-coll-link" href={`/collections/${data.collectionContext.collectionId}`}>
            {data.collectionContext.collectionTitle}
          </a>
          <span class="reader-coll-pos">
            {data.collectionContext.position + 1}/{data.collectionContext.totalCount}
          </span>
          <span class="reader-coll-nav">
            {#if data.collectionContext.prevTextId}
              <a
                href={`/reader/${data.collectionContext.prevTextId}`}
                class="reader-coll-arrow"
                title="Previous text"
                aria-label="Previous text in collection">‹ prev</a
              >
            {/if}
            {#if data.collectionContext.nextTextId}
              {#if data.collectionContext.nextLocked}
                <a
                  href={`/reader/${data.collectionContext.nextTextId}?skipLock=1`}
                  class="reader-coll-arrow reader-coll-locked"
                  title="Course gate — finish this text or click to skip"
                  aria-label="Next text (locked — finish to advance, or click to skip)">next 🔒</a
                >
              {:else}
                <a
                  href={`/reader/${data.collectionContext.nextTextId}`}
                  class="reader-coll-arrow"
                  title="Next text"
                  aria-label="Next text in collection">next ›</a
                >
              {/if}
            {/if}
          </span>
        </p>
      {/if}
      <h1 class="t">{data.text.title}</h1>
      <p class="a">
        <span class="badge">{data.text.language}</span>
        <span class="badge status-{liveStatus}">{statusLabel}</span>
        <span class="badge">{data.text.visibility}</span>
      </p>
    </div>

    <div class="reader-tools">
      <div class="mode-switch" role="group" aria-label="Reading mode">
        <button
          type="button"
          data-active={data.mode === 'page' ? '1' : '0'}
          onclick={() => setMode('page')}
        >
          Page
        </button>
        <button
          type="button"
          data-active={data.mode === 'paged_scroll' ? '1' : '0'}
          onclick={() => setMode('paged_scroll')}
        >
          Scroll
        </button>
        <button
          type="button"
          data-active={data.mode === 'continuous' ? '1' : '0'}
          onclick={() => setMode('continuous')}
        >
          Continuous
        </button>
      </div>

      <button
        type="button"
        class="roman-toggle"
        data-active={showRomanization ? '1' : '0'}
        onclick={toggleRomanization}
        aria-pressed={showRomanization}
        title="Toggle romanization"
      >
        Aa
      </button>

      <button
        type="button"
        class="settings-toggle"
        onclick={() => (settingsOpen = true)}
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

      <!-- T-5.26 moved the immersive / hide-chrome toggle to the
           AppShell rail (a hamburger glyph) — it's globally available
           now, not just from the reader top bar. -->
    </div>
  </header>

  {#if liveStatus === 'failed' && liveError}
    <p class="err" role="alert">Processing error: {liveError}</p>
  {/if}

  {#if data.mode === 'page'}
    <ReaderPage
      chapters={data.chapters}
      chapterIdx={data.anchor.chapterIdx}
      initialTokenIdx={data.anchor.tokenIdx}
      textId={data.text.id}
      language={data.text.language as LanguageCode}
      {showRomanization}
      isOwner={data.isOwner}
      onProgress={onReaderProgress}
      fontSize={readerSettings.fontSize}
      lineSpacing={readerSettings.lineSpacing}
      fontFamily={readerSettings.fontFamily}
      readingWidth={readerSettings.readingWidth}
    />
  {:else if data.mode === 'paged_scroll'}
    <ReaderScroll
      chapters={data.chapters}
      chapterIdx={data.anchor.chapterIdx}
      initialTokenIdx={data.anchor.tokenIdx}
      wordsPerPage={readerSettings.wordsPerPage}
      language={data.text.language as LanguageCode}
      {showRomanization}
      isOwner={data.isOwner}
      onProgress={onReaderProgress}
    />
  {:else}
    <ReaderContinuous
      chapters={data.chapters}
      initialChapterIdx={data.anchor.chapterIdx}
      initialTokenIdx={data.anchor.tokenIdx}
      textId={data.text.id}
      language={data.text.language as LanguageCode}
      {showRomanization}
      isOwner={data.isOwner}
      onProgress={onReaderProgress}
    />
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
  onChange={(next) => (readerSettings = next)}
  canPersist={data.canPersistSettings}
/>

<style>
  /* CIAR design reader chrome (T-5.9). Paper background + serif title.
     Stacks on small viewports; mode-switch + romanization sit on the
     right at >=640px. */
  .reader {
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    /* Fill the AppShell's content track so page mode can occupy the
       full vertical space (T-5.23). Children flex-stack vertically:
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
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
  }
  /* The top bar lives inside the reader's right column (sticky inside
     the AppShell content track, not over the rail). The right side
     panel reads `--reader-top-h` to anchor below it. */
  .reader-top {
    position: sticky;
    top: 0;
    z-index: 5;
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
  /* T-5.27: small × close button replacing the "← Library" crumb. */
  .reader-close {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--ink-3, var(--color-fg-muted));
    text-decoration: none;
    border: 1px solid transparent;
    border-radius: 8px;
    transition:
      background 150ms ease,
      color 150ms ease,
      border-color 150ms ease;
  }
  .reader-close:hover {
    color: var(--ink, var(--color-fg));
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    border-color: var(--rule, var(--color-border));
  }
  .reader-meta {
    min-width: 0;
  }
  .reader-coll-strip {
    margin: 0 0 0.25rem;
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    font-size: 0.7rem;
    color: var(--ink-3, var(--color-fg-muted));
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-wrap: wrap;
  }
  .reader-coll-link {
    color: var(--ink-2, var(--color-fg));
    text-decoration: none;
    font-weight: 500;
  }
  .reader-coll-link:hover {
    text-decoration: underline;
  }
  .reader-coll-pos {
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
  }
  .reader-coll-nav {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
  }
  .reader-coll-arrow {
    color: var(--accent, var(--color-accent));
    text-decoration: none;
    font-weight: 500;
  }
  .reader-coll-arrow:hover {
    text-decoration: underline;
  }
  .reader-coll-locked {
    color: var(--ink-3, var(--color-fg-muted));
    opacity: 0.7;
  }
  .reader-meta .t {
    margin: 0;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.125rem;
    font-weight: 500;
    color: var(--ink, var(--color-fg));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .reader-meta .a {
    margin: 0.15rem 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .badge {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 0.6rem;
    border-radius: 999px;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    color: var(--ink-2, var(--color-fg-muted));
    font-size: 0.7rem;
    letter-spacing: 0.01em;
  }
  .status-ready {
    background: var(--green-soft, color-mix(in srgb, #197a2f 12%, transparent));
    color: var(--green, #197a2f);
  }
  .status-failed {
    background: var(--rose-soft, color-mix(in srgb, #b03131 12%, transparent));
    color: var(--rose, #b03131);
  }
  .status-processing,
  .status-pending {
    background: var(--accent-soft, color-mix(in srgb, #b07a31 12%, transparent));
    color: var(--accent-ink, #b07a31);
  }
  .reader-tools {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .mode-switch {
    display: inline-flex;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 5%, transparent);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
  }
  .mode-switch button {
    height: 28px;
    padding: 0 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    color: var(--ink-2, var(--color-fg-muted));
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .mode-switch button[data-active='1'] {
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
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
  /* T-5.26: the immersive-toggle button moved to AppShell as a
     hamburger icon. The selector is gone but the Esc-to-exit
     behavior stays in this component. */
  .err {
    color: var(--rose, #b03131);
    background: var(--rose-soft, color-mix(in srgb, #b03131 8%, transparent));
    border: 1px solid color-mix(in srgb, #b03131 30%, transparent);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin: 1rem 1.25rem 0;
  }
</style>
