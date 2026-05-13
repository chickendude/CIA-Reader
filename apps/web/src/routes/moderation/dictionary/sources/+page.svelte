<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

  // SSR data is the initial truth; the polling refresh below
  // overwrites it. Re-syncs to the loader output whenever the page
  // re-renders (e.g. after an action `invalidateAll`).
  let polled = $state<PageData['sources'] | null>(null);
  const sources = $derived(polled ?? data.sources);

  // Poll the JSON endpoint every 2 s while any row shows a running
  // job — when nothing's in flight, we don't poll, so an idle admin
  // page is silent.
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  $effect(() => {
    const anyRunning = sources.some((s) => s.activeJob?.status === 'running');
    if (anyRunning && !pollHandle) {
      pollHandle = setInterval(refresh, 2000);
    }
    if (!anyRunning && pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  });
  onDestroy(() => {
    if (pollHandle) clearInterval(pollHandle);
  });

  async function refresh() {
    try {
      const res = await fetch('/api/v1/admin/dictionary-sources');
      if (!res.ok) return;
      const json = (await res.json()) as { sources: PageData['sources'] };
      polled = json.sources;
    } catch {
      // transient network errors: try again next tick
    }
  }

  function formatBytes(n: number | null): string {
    if (n == null) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatTime(d: string | Date | null): string {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleString();
  }

  function relTime(d: string | Date | null): string {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    const diffMs = Date.now() - date.getTime();
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const days = Math.round(hr / 24);
    return `${days}d ago`;
  }

  function jobLabel(state: 'cached' | 'partial' | 'missing'): string {
    switch (state) {
      case 'cached':
        return 'Cached';
      case 'partial':
        return 'Interrupted (.tmp present)';
      case 'missing':
        return 'Not cached';
    }
  }

  async function onSubmit(e: SubmitEvent) {
    // Refresh after the form action returns so a job that finishes
    // synchronously (e.g. JobAlreadyRunningError) doesn't have to
    // wait for the 2s poll.
    queueMicrotask(() => invalidateAll());
    void e;
  }
</script>

<svelte:head>
  <title>Dictionary sources — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header>
    <h1>Dictionary sources</h1>
    <p class="sub">
      Cache state, last import, and contribution counts for every registered importer.
      Admin-only — actions kick off in-process jobs.
    </p>
    <nav class="mod-nav" aria-label="Moderation sections">
      <a href="/moderation/dictionary">← Dictionary moderation</a>
      <a href="/moderation/dictionary/bulk">Bulk tools</a>
      <a href="/moderation/paradigms">Paradigms</a>
    </nav>
  </header>

  {#if form?.message}
    <p class:error={form.ok === false} class:success={form.ok === true} class="flash" role="status">
      {form.message}
    </p>
  {/if}

  <form method="post" action="?/fetchAllMissing" class="bulk-row">
    <button type="submit">Fetch all missing</button>
    <span class="muted">Triggers a fetch for every row currently in <strong>Not cached</strong>.</span>
  </form>

  <table>
    <thead>
      <tr>
        <th>Source</th>
        <th>Lang</th>
        <th>Raw cache</th>
        <th>Last import</th>
        <th>Contribution</th>
        <th>Job</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each sources as row (row.slug)}
        <tr>
          <td>
            <code>{row.slug}</code>
            <div class="attribution">{row.attribution}</div>
            <div class="license muted">{row.license}</div>
          </td>
          <td>{row.language}</td>
          <td>
            <div class:state-cached={row.cache.state === 'cached'} class:state-partial={row.cache.state === 'partial'} class:state-missing={row.cache.state === 'missing'} class="state">
              {jobLabel(row.cache.state)}
            </div>
            {#if row.cache.exists}
              <div class="muted">
                {formatBytes(row.cache.sizeBytes)} · {row.cache.lineCount?.toLocaleString() ?? '—'} lines
              </div>
              <div class="muted" title={formatTime(row.cache.mtime)}>
                {relTime(row.cache.mtime)}
              </div>
            {/if}
          </td>
          <td>
            {#if row.lastImport}
              <div class:status-failed={row.lastImport.status === 'failed'} class="status">
                {row.lastImport.status}
              </div>
              <div class="muted" title={formatTime(row.lastImport.runAt)}>
                {relTime(row.lastImport.runAt)}
              </div>
              {#if row.lastImport.errorMessage}
                <div class="error-msg">{row.lastImport.errorMessage}</div>
              {/if}
            {:else}
              <span class="muted">Never</span>
            {/if}
          </td>
          <td>
            <div>{row.contribution.lemmas.toLocaleString()} lemmas</div>
            <div class="muted">{row.contribution.translations.toLocaleString()} translations</div>
          </td>
          <td>
            {#if row.activeJob}
              <div class="job-pill" class:running={row.activeJob.status === 'running'} class:failed={row.activeJob.status === 'failed'} class:done={row.activeJob.status === 'done'}>
                {row.activeJob.kind} · {row.activeJob.status}
              </div>
              {#if row.activeJob.errorMessage}
                <div class="error-msg">{row.activeJob.errorMessage}</div>
              {/if}
            {:else}
              <span class="muted">—</span>
            {/if}
          </td>
          <td>
            <div class="actions">
              <form method="post" action="?/fetch" onsubmit={onSubmit}>
                <input type="hidden" name="slug" value={row.slug} />
                <button type="submit" disabled={row.activeJob?.status === 'running'}>Re-fetch</button>
              </form>
              <form method="post" action="?/import" onsubmit={onSubmit}>
                <input type="hidden" name="slug" value={row.slug} />
                <button type="submit" disabled={!row.cache.exists || row.activeJob?.status === 'running'}>
                  Re-import
                </button>
              </form>
              <form method="post" action="?/delete" onsubmit={onSubmit}>
                <input type="hidden" name="slug" value={row.slug} />
                <button
                  type="submit"
                  class="danger"
                  disabled={!row.cache.exists}
                  onclick={(e) => {
                    if (!confirm(`Delete cached raw.jsonl for ${row.slug}? Re-fetch is the slow operation, so confirm.`)) {
                      e.preventDefault();
                    }
                  }}
                >
                  Delete cache
                </button>
              </form>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .page {
    max-width: 78rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
  }
  .sub {
    margin: 0 0 1rem;
    color: var(--color-fg-muted);
  }
  .muted {
    color: var(--color-fg-muted);
    font-size: 0.85rem;
  }
  .mod-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
    font-size: 0.85rem;
    margin: 0.5rem 0 1.25rem;
  }
  .mod-nav a {
    color: var(--color-fg-muted);
    text-decoration: none;
  }
  .mod-nav a:hover {
    color: var(--color-fg);
    text-decoration: underline;
  }
  .flash {
    padding: 0.6rem 0.85rem;
    margin: 0.5rem 0 1rem;
    border-radius: 6px;
    border-left: 3px solid var(--color-accent);
    background: var(--color-info-bg, #eef5ff);
  }
  .flash.error {
    background: var(--color-error-bg, #fde2e2);
    border-left-color: var(--color-error, #c62828);
  }
  .bulk-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }
  th,
  td {
    padding: 0.6rem 0.5rem;
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
    text-align: left;
  }
  th {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-fg-muted);
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.9rem;
  }
  .attribution {
    margin-top: 0.15rem;
    font-size: 0.85rem;
  }
  .license {
    font-size: 0.75rem;
  }
  .state {
    font-weight: 500;
  }
  .state-cached {
    color: var(--color-success, #2e7d32);
  }
  .state-partial {
    color: var(--color-warn, #ef6c00);
  }
  .state-missing {
    color: var(--color-fg-muted);
  }
  .status {
    font-weight: 500;
    text-transform: capitalize;
  }
  .status-failed {
    color: var(--color-error, #c62828);
  }
  .job-pill {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.78rem;
    background: var(--color-border);
  }
  .job-pill.running {
    background: var(--color-info-bg, #eef5ff);
    color: var(--color-accent);
  }
  .job-pill.failed {
    background: var(--color-error-bg, #fde2e2);
    color: var(--color-error, #c62828);
  }
  .job-pill.done {
    background: var(--color-success-bg, #e3f2da);
    color: var(--color-success, #2e7d32);
  }
  .error-msg {
    margin-top: 0.25rem;
    font-size: 0.78rem;
    color: var(--color-error, #c62828);
    white-space: pre-wrap;
    max-width: 22rem;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .actions form {
    margin: 0;
  }
  button {
    padding: 0.35rem 0.7rem;
    font-size: 0.85rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-bg);
    color: var(--color-fg);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.danger {
    color: var(--color-error, #c62828);
  }
</style>
