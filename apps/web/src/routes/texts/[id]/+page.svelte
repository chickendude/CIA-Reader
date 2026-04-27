<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Polling state — drives the "processing" → "ready" UX without a
  // page reload. We hit GET /api/v1/texts/:id/status every couple of
  // seconds while status is pending or processing, then call
  // `invalidateAll()` to re-run the loader so the new chapters /
  // status are reflected without losing scroll position.
  let liveStatus = $state(untrack(() => data.text.status));
  let liveError = $state<string | null>(null);

  function shouldPoll(s: typeof data.text.status): boolean {
    return s === 'pending' || s === 'processing';
  }

  // The placeholder viewer just renders paragraphs from the raw chapter
  // body. M5 swaps each paragraph for token-aware rendering with the
  // word pop-up, known-words highlighting, and the three reading modes.
  function paragraphs(body: string): string[] {
    return body.split(/\n\s*\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
  }

  const statusLabel = $derived(
    {
      pending: 'Waiting to be processed',
      processing: 'Processing — please wait',
      ready: 'Ready',
      failed: 'Processing failed',
    }[liveStatus] ?? liveStatus,
  );

  onMount(() => {
    // Sync our local mirror to whatever the loader saw on first load,
    // then start polling if needed.
    liveStatus = data.text.status;

    if (!shouldPoll(liveStatus)) return;

    // Conservative 2.5s interval — fast enough that the user feels the
    // "ready" flip is responsive, slow enough that an idle queue
    // doesn't burn a request per second per open tab.
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/texts/${data.text.id}/status`, {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          status: typeof data.text.status;
          statusError: string | null;
        };
        liveStatus = payload.status;
        liveError = payload.statusError;
        if (!shouldPoll(payload.status)) {
          window.clearInterval(interval);
          // Re-run the loader so chapter content + tokenCount that
          // changed during processing are picked up.
          await invalidateAll();
        }
      } catch {
        // Network blips just retry on the next tick.
      }
    }, 2500);

    return () => window.clearInterval(interval);
  });
</script>

<svelte:head>
  <title>{data.text.title} — CIA Reader</title>
</svelte:head>

<div class="page">
  <p class="crumb">
    <a href="/upload">← Upload another</a>
  </p>

  <header>
    <h1>{data.text.title}</h1>
    <p class="meta">
      <span>{data.text.language}</span>
      <span class="dot">·</span>
      <span class="badge">{data.text.sourceType}</span>
      <span class="dot">·</span>
      <span class="badge status-{liveStatus}">{statusLabel}</span>
      <span class="dot">·</span>
      <span class="badge">{data.text.visibility}</span>
    </p>
  </header>

  {#if liveStatus === 'failed' && liveError}
    <p class="err" role="alert">Processing error: {liveError}</p>
  {/if}

  <p class="placeholder-note">
    This is a placeholder view — the full tap-to-translate reader lands
    in milestone M5. For now you can confirm your upload made it to the
    database.
  </p>

  {#each data.chapters as chapter (chapter.id)}
    <section>
      {#if chapter.title || data.chapters.length > 1}
        <h2>
          {chapter.title ?? `Chapter ${chapter.idx + 1}`}
          <span class="muted">({chapter.tokenCount.toLocaleString()} tokens)</span>
        </h2>
      {/if}
      {#each paragraphs(chapter.body) as p}
        <p class="body">{p}</p>
      {/each}
    </section>
  {/each}
</div>

<style>
  .page {
    max-width: 42rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  .crumb {
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .crumb a {
    color: var(--color-accent);
  }
  header h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
  }
  .meta {
    margin: 0 0 1rem;
    font-size: 0.85rem;
    color: var(--color-fg-muted);
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .meta .dot {
    color: var(--color-border);
  }
  .badge {
    font-size: 0.72rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-fg-muted);
  }
  .status-pending {
    border-color: color-mix(in srgb, #b07a31 60%, transparent);
    color: #b07a31;
  }
  .status-ready {
    border-color: color-mix(in srgb, #197a2f 60%, transparent);
    color: #197a2f;
  }
  .status-failed {
    border-color: color-mix(in srgb, #b03131 60%, transparent);
    color: #b03131;
  }
  .placeholder-note {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: var(--color-fg);
    font-size: 0.85rem;
    margin-bottom: 1.5rem;
  }
  section {
    margin: 1.5rem 0;
  }
  section h2 {
    font-size: 1.05rem;
    margin: 0 0 0.5rem;
  }
  .muted {
    font-weight: 400;
    color: var(--color-fg-muted);
    font-size: 0.85em;
    margin-left: 0.4rem;
  }
  .body {
    margin: 0 0 0.75rem;
    line-height: 1.7;
    font-size: 1.05rem;
  }
  .err {
    color: #b03131;
    background: color-mix(in srgb, #b03131 8%, transparent);
    border: 1px solid color-mix(in srgb, #b03131 30%, transparent);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
  }
</style>
