<script lang="ts">
  import { LANGUAGES } from '@ciareader/shared-types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function formatPercent(n: number): string {
    return `${(n * 100).toFixed(1)}%`;
  }
  function formatHours(h: number): string {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 48) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  }
</script>

<svelte:head>
  <title>Correction stats — moderation</title>
</svelte:head>

<div class="ms">
  <header class="ms-h">
    <h1>Correction stats</h1>
    <p class="ms-h-sub">
      Lightweight per-language metrics on parse accuracy, the curator queue,
      and time-to-resolution. Track these over time as overrides + dictionary
      expansions ship.
    </p>
  </header>

  <section class="ms-section">
    <h2>Estimated lemma accuracy</h2>
    <p class="ms-meta">
      <code>1 − corrections ÷ tokens</code>. Falls when readers correct more,
      rises when the worker + override table catch up.
    </p>
    <table class="ms-table">
      <thead>
        <tr>
          <th>Language</th>
          <th class="num">Tokens</th>
          <th class="num">Corrections</th>
          <th class="num">Correction rate</th>
          <th class="num">Est. accuracy</th>
        </tr>
      </thead>
      <tbody>
        {#each data.accuracy as row (row.language)}
          <tr>
            <td>{LANGUAGES[row.language]?.displayName ?? row.language}</td>
            <td class="num">{row.totalTokens.toLocaleString()}</td>
            <td class="num">{row.correctedTokens.toLocaleString()}</td>
            <td class="num">{formatPercent(row.correctionRate)}</td>
            <td class="num"><strong>{formatPercent(row.estimatedAccuracy)}</strong></td>
          </tr>
        {:else}
          <tr><td colspan="5" class="ms-muted">No data yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="ms-section">
    <h2>Top reported surfaces</h2>
    <p class="ms-meta">
      Sums <code>duplicate_count</code> across all statuses — the heaviest hitters
      regardless of whether the curator has resolved each report.
    </p>
    <table class="ms-table">
      <thead>
        <tr>
          <th>Language</th>
          <th>Surface</th>
          <th class="num">Reports</th>
          <th class="num">Total dupes</th>
        </tr>
      </thead>
      <tbody>
        {#each data.topReportedSurfaces as row, i (i)}
          <tr>
            <td>{row.language}</td>
            <td><bdi class="ms-surface">{row.surfaceNfc}</bdi></td>
            <td class="num">{row.reportCount}</td>
            <td class="num"><strong>{row.totalDuplicates}</strong></td>
          </tr>
        {:else}
          <tr><td colspan="4" class="ms-muted">No reports filed yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="ms-section">
    <h2>Backlog</h2>
    <table class="ms-table">
      <thead>
        <tr>
          <th>Language</th>
          <th>Status</th>
          <th class="num">Count</th>
        </tr>
      </thead>
      <tbody>
        {#each data.backlog as row, i (i)}
          <tr>
            <td>{LANGUAGES[row.language]?.displayName ?? row.language}</td>
            <td>{row.status}</td>
            <td class="num">{row.count}</td>
          </tr>
        {:else}
          <tr><td colspan="3" class="ms-muted">Empty.</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="ms-section">
    <h2>Median time-to-resolution</h2>
    <table class="ms-table">
      <thead>
        <tr>
          <th>Language</th>
          <th class="num">Median</th>
          <th class="num">Resolved reports</th>
        </tr>
      </thead>
      <tbody>
        {#each data.latency as row (row.language)}
          <tr>
            <td>{LANGUAGES[row.language]?.displayName ?? row.language}</td>
            <td class="num">{formatHours(row.medianHours)}</td>
            <td class="num">{row.resolvedCount}</td>
          </tr>
        {:else}
          <tr><td colspan="3" class="ms-muted">No reports resolved yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
</div>

<style>
  .ms {
    padding: 1.25rem 1.5rem 2rem;
    color: var(--ink, var(--color-fg));
    max-width: 64rem;
  }
  .ms-h h1 {
    margin: 0 0 0.2rem;
    font-size: 1.4rem;
    font-family: var(--font-serif, system-ui);
  }
  .ms-h-sub {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    margin: 0 0 1.5rem;
  }
  .ms-section {
    margin-bottom: 2rem;
  }
  .ms-section h2 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0 0 0.5rem;
  }
  .ms-meta {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
    margin: 0 0 0.7rem;
  }
  .ms-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    overflow: hidden;
  }
  .ms-table th,
  .ms-table td {
    padding: 0.5rem 0.7rem;
    text-align: left;
    border-bottom: 1px solid var(--rule-2, var(--color-border));
  }
  .ms-table th {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 4%, transparent);
    font-weight: 500;
    font-size: 0.78rem;
  }
  .ms-table th.num,
  .ms-table td.num {
    text-align: right;
    font-feature-settings: 'tnum';
    font-family: var(--font-mono-display, var(--font-mono));
  }
  .ms-surface {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1rem;
  }
  .ms-muted {
    color: var(--ink-3, var(--color-fg-muted));
    text-align: center;
    padding: 1rem;
  }
</style>
