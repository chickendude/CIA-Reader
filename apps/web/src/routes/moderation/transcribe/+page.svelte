<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  function pct(verified: number, total: number): string {
    if (total === 0) return '0%';
    return `${Math.floor((verified / total) * 100)}%`;
  }
</script>

<svelte:head>
  <title>Transcription workbench — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header>
    <h1>Transcription workbench</h1>
    <p class="sub">
      Verify imported dictionary drafts against the public-domain page
      scans. A verified entry becomes our own transcription and is
      permanently protected from re-imports.
    </p>
  </header>

  {#if data.dictionaries.length === 0}
    <p class="empty">
      No scan-backed dictionaries in your granted languages. Ask an
      admin for curator rights.
    </p>
  {/if}

  <div class="cards">
    {#each data.dictionaries as dict (dict.slug)}
      <a class="card" href={`/moderation/transcribe/${dict.slug}`}>
        <h2>{dict.citation}</h2>
        <p class="meta">
          {dict.progress.verified.toLocaleString()} /
          {dict.progress.total.toLocaleString()} verified
          ({pct(dict.progress.verified, dict.progress.total)})
          {#if dict.progress.flagged > 0}
            · {dict.progress.flagged} flagged
          {/if}
        </p>
        {#if dict.volumes.length === 0}
          <p class="warn">
            No scans ingested yet — run
            <code>pnpm scan:ingest {dict.slug} …</code>
          </p>
        {:else}
          <p class="meta">
            {dict.volumes.length}
            {dict.volumes.length === 1 ? 'volume' : 'volumes'} ingested
            ({dict.volumes.reduce((n, v) => n + v.pageCount, 0)} pages)
          </p>
        {/if}
      </a>
    {/each}
  </div>
</div>

<style>
  .page {
    max-width: 60rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }
  .sub {
    color: var(--text-secondary, #444);
    max-width: 44rem;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
    gap: 1rem;
    margin-top: 1.5rem;
  }
  .card {
    display: block;
    border: 1px solid var(--border, #ccc);
    border-radius: 8px;
    padding: 1rem;
    text-decoration: none;
    color: inherit;
  }
  .card:hover {
    border-color: var(--accent, #2563eb);
  }
  .card h2 {
    font-size: 1.05rem;
    margin: 0 0 0.5rem;
  }
  .meta {
    margin: 0.25rem 0;
    color: var(--text-secondary, #444);
    font-size: 0.9rem;
  }
  .warn {
    margin: 0.25rem 0;
    color: var(--warning-text, #92400e);
    font-size: 0.9rem;
  }
  .empty {
    color: var(--text-secondary, #444);
  }
</style>
