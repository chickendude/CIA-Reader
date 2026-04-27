<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, untrack } from 'svelte';

  import ReaderContinuous from '$lib/components/reader/ReaderContinuous.svelte';
  import ReaderPage from '$lib/components/reader/ReaderPage.svelte';
  import ReaderScroll from '$lib/components/reader/ReaderScroll.svelte';
  import { ProgressWriter } from '$lib/components/reader/progress-client.js';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

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

  function setMode(mode: 'page' | 'paged_scroll' | 'continuous') {
    const params = new URLSearchParams();
    params.set('mode', mode);
    if (data.anchor.chapterIdx) params.set('chapter', String(data.anchor.chapterIdx));
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

  // T-5.6 progress writer. Only owners get one — anonymous viewers
  // of an official text don't have a row to write against.
  let progressWriter: ProgressWriter | null = null;
  let beforeUnloadHandler: (() => void) | null = null;

  onMount(() => {
    liveStatus = data.text.status;

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

    // Progress writer — owners only.
    if (data.isOwner) {
      progressWriter = new ProgressWriter(data.text.id);
      // Schedule an initial write so reopening immediately at the
      // current chapter persists even without scrolling.
      const totalChapters = data.chapters.length;
      const pctRead =
        totalChapters > 0
          ? Math.round(((data.anchor.chapterIdx + 1) / totalChapters) * 100)
          : 0;
      progressWriter.schedule({
        chapterIdx: data.anchor.chapterIdx,
        tokenIdx: data.anchor.tokenIdx,
        pctRead,
      });
      // Flush on tab close so the user resumes near where they were
      // even if their last action was scrolling and they didn't trip
      // the debounce timer.
      beforeUnloadHandler = () => {
        void progressWriter?.flush();
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);
    }

    return () => {
      cleanupPoll?.();
      if (beforeUnloadHandler)
        window.removeEventListener('beforeunload', beforeUnloadHandler);
      void progressWriter?.flush();
    };
  });

  // Watch URL anchor changes and write them to the progress writer.
  // The mode-toggle / chapter-nav buttons all funnel through goto(),
  // which re-runs the loader and hands us a new `data.anchor` —
  // sending here keeps a fresh row even if the user navigates by
  // URL without scrolling.
  $effect(() => {
    if (!progressWriter) return;
    const totalChapters = data.chapters.length;
    const pctRead =
      totalChapters > 0
        ? Math.round(((data.anchor.chapterIdx + 1) / totalChapters) * 100)
        : 0;
    progressWriter.schedule({
      chapterIdx: data.anchor.chapterIdx,
      tokenIdx: data.anchor.tokenIdx,
      pctRead,
    });
  });
</script>

<svelte:head>
  <title>{data.text.title} — CIA Reader</title>
</svelte:head>

<div class="reader">
  <header class="toolbar">
    <p class="crumb">
      <a href="/library">← Library</a>
    </p>
    <div class="title-row">
      <h1>{data.text.title}</h1>
      <p class="meta">
        <span class="badge">{data.text.language}</span>
        <span class="badge">{data.text.sourceType}</span>
        <span class="badge status-{liveStatus}">{statusLabel}</span>
        <span class="badge">{data.text.visibility}</span>
      </p>
    </div>

    <div class="toolbar-row">
      <div class="mode-toggle" role="group" aria-label="Reading mode">
        <button
          type="button"
          class:active={data.mode === 'page'}
          onclick={() => setMode('page')}
        >
          Page
        </button>
        <button
          type="button"
          class:active={data.mode === 'paged_scroll'}
          onclick={() => setMode('paged_scroll')}
        >
          Paged scroll
        </button>
        <button
          type="button"
          class:active={data.mode === 'continuous'}
          onclick={() => setMode('continuous')}
        >
          Continuous
        </button>
      </div>

      <button
        type="button"
        class="roman-toggle"
        class:active={showRomanization}
        onclick={toggleRomanization}
        aria-pressed={showRomanization}
      >
        Show romanization
      </button>
    </div>
  </header>

  {#if liveStatus === 'failed' && liveError}
    <p class="err" role="alert">Processing error: {liveError}</p>
  {/if}

  {#if data.mode === 'page'}
    <ReaderPage
      chapters={data.chapters}
      chapterIdx={data.anchor.chapterIdx}
      textId={data.text.id}
      {showRomanization}
      isOwner={data.isOwner}
    />
  {:else if data.mode === 'paged_scroll'}
    <ReaderScroll
      chapters={data.chapters}
      chapterIdx={data.anchor.chapterIdx}
      {showRomanization}
      isOwner={data.isOwner}
    />
  {:else}
    <ReaderContinuous
      chapters={data.chapters}
      initialChapterIdx={data.anchor.chapterIdx}
      {showRomanization}
      isOwner={data.isOwner}
    />
  {/if}
</div>

<style>
  .reader {
    --reader-toolbar-bg: var(--color-bg);
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--reader-toolbar-bg);
    border-bottom: 1px solid var(--color-border);
    padding: 0.75rem 1.25rem 0.85rem;
  }
  .crumb {
    margin: 0 0 0.4rem;
    font-size: 0.85rem;
  }
  .crumb a {
    color: var(--color-accent);
  }
  .title-row {
    margin-bottom: 0.6rem;
  }
  .title-row h1 {
    margin: 0 0 0.25rem;
    font-size: 1.25rem;
  }
  .meta {
    margin: 0;
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
    color: var(--color-fg-muted);
  }
  .badge {
    font-size: 0.72rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-fg-muted);
  }
  .status-ready {
    border-color: color-mix(in srgb, #197a2f 60%, transparent);
    color: #197a2f;
  }
  .status-failed {
    border-color: color-mix(in srgb, #b03131 60%, transparent);
    color: #b03131;
  }
  .status-processing,
  .status-pending {
    border-color: color-mix(in srgb, #b07a31 60%, transparent);
    color: #b07a31;
  }
  .toolbar-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: space-between;
  }
  .mode-toggle {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .roman-toggle {
    padding: 0.4rem 0.75rem;
    font: inherit;
    font-size: 0.85rem;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-fg-muted);
    border-radius: 999px;
    cursor: pointer;
    min-height: 36px;
  }
  .roman-toggle.active {
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border-color: var(--color-accent);
  }
  .mode-toggle button {
    padding: 0.4rem 0.75rem;
    font: inherit;
    font-size: 0.85rem;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-fg);
    border-radius: 999px;
    cursor: pointer;
    min-height: 36px;
  }
  .mode-toggle button.active {
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border-color: var(--color-accent);
  }
  .err {
    color: #b03131;
    background: color-mix(in srgb, #b03131 8%, transparent);
    border: 1px solid color-mix(in srgb, #b03131 30%, transparent);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin: 1rem 1.25rem 0;
  }
</style>
