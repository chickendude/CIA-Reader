<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, untrack } from 'svelte';

  import ReaderContinuous from '$lib/components/reader/ReaderContinuous.svelte';
  import ReaderPage from '$lib/components/reader/ReaderPage.svelte';
  import ReaderScroll from '$lib/components/reader/ReaderScroll.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Live status mirrors data.text.status; flips when the polling loop
  // hits a terminal state (T-4.4).
  let liveStatus = $state(untrack(() => data.text.status));
  let liveError = $state<string | null>(null);

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
    void goto(
      `/reader/${data.text.id}?mode=${mode}&chapter=${data.anchor.chapterIdx}`,
      { keepFocus: true },
    );
  }

  onMount(() => {
    liveStatus = data.text.status;
    if (!data.isOwner) return;
    if (!shouldPoll(liveStatus)) return;
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
    return () => window.clearInterval(interval);
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
  </header>

  {#if liveStatus === 'failed' && liveError}
    <p class="err" role="alert">Processing error: {liveError}</p>
  {/if}

  {#if data.mode === 'page'}
    <ReaderPage
      chapters={data.chapters}
      chapterIdx={data.anchor.chapterIdx}
      textId={data.text.id}
    />
  {:else if data.mode === 'paged_scroll'}
    <ReaderScroll chapters={data.chapters} chapterIdx={data.anchor.chapterIdx} />
  {:else}
    <ReaderContinuous
      chapters={data.chapters}
      initialChapterIdx={data.anchor.chapterIdx}
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
  .mode-toggle {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
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
