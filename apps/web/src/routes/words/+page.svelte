<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageData } from './$types';
  import { encodeStatuses, WORD_STATUSES, type WordStatus } from './word-statuses';

  let { data }: { data: PageData } = $props();
  const selected = $derived(data.filters.statuses);
  const allSelected = $derived(selected.length === WORD_STATUSES.length);
  let saving = $state(false);

  function toggleValue(status: WordStatus): string {
    const next = selected.includes(status)
      ? selected.filter((item) => item !== status)
      : [...selected, status];
    return encodeStatuses(next);
  }

  const saveSelection: SubmitFunction = () => {
    saving = true;
    return async ({ update }) => {
      try {
        await update();
      } finally {
        saving = false;
      }
    };
  };

  function relativeFromNow(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const seconds = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.round(minutes)}m ago`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours)}h ago`;
    const days = hours / 24;
    if (days < 14) return `${Math.round(days)}d ago`;
    const weeks = days / 7;
    if (weeks < 8) return `${Math.round(weeks)}w ago`;
    const months = days / 30;
    return `${Math.round(months)}mo ago`;
  }
</script>

<svelte:head>
  <title>Words | Parhiba</title>
</svelte:head>

<section class="content">
  <header class="topbar">
    <h1 class="page-title">Words</h1>
    <div class="actions">
      <a class="export-link" href={`/api/v1/me/vocabulary/export?language=${data.filters.language}`}>Export CSV</a>
      <a class="export-link" href="/words/anki/import">Import from Anki</a>
      <a class="export-link" href="/words/anki">Export to Anki</a>
    </div>
  </header>

  <div class="filters">
    <form method="post" action="?/filter" use:enhance={saveSelection}>
      <input type="hidden" name="q" value={data.filters.q} />
      <fieldset class="status-tabs" disabled={saving} aria-label="Word statuses">
        <button
          class="status-tab"
          name="status"
          value={allSelected ? 'none' : 'all'}
          aria-pressed={allSelected ? true : selected.length ? 'mixed' : false}
        >All</button>
        {#each WORD_STATUSES as status (status)}
          <button
            class="status-tab"
            name="status"
            value={toggleValue(status)}
            aria-pressed={selected.includes(status)}
          >
            {status} <span class="count">{data.counts[status].toLocaleString()}</span>
          </button>
        {/each}
      </fieldset>
    </form>

    <form method="get" class="filterbar" role="search">
      <input
        type="search"
        name="q"
        value={data.filters.q}
        aria-label="Search words and definitions"
        placeholder="Search words and definitions"
        autocomplete="off"
      />
      <input type="hidden" name="status" value={encodeStatuses(selected)} />
      <button class="filter-go" type="submit">Search</button>
    </form>
  </div>

  {#if data.rows.length === 0}
    <p class="empty">
      {#if selected.length === 0}
        Select a status to see words.
      {:else if data.filters.q}
        No words match this search. <a href={`/words?status=${encodeStatuses(selected)}`}>Clear search</a>.
      {:else}
        No words with the selected statuses.
      {/if}
    </p>
  {:else}
    <div class="table-wrap">
      <table class="kw-table" aria-label="Vocabulary">
        <thead>
          <tr>
            <th class="col-word">Word</th>
            <th class="col-pos">POS</th>
            <th class="col-def">Definition</th>
            <th class="col-status">Status</th>
            <th class="col-when">Updated</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.lemmaId)}
            <tr>
              <td class="col-word">
                <span class="kw-word" lang={data.filters.language}>{row.headword}</span>
              </td>
              <td class="col-pos muted">{row.pos}</td>
              <td class="col-def">
                {row.glossDefault ?? ''}
              </td>
              <td class="col-status">
                <span class="status" data-status={row.status}>{row.status}</span>
              </td>
              <td class="col-when muted">{relativeFromNow(row.updatedAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if data.truncated}
      <p class="empty muted small">
        Showing the {data.rows.length} most recently updated entries.
      </p>
    {/if}
  {/if}
</section>

<style>
  .topbar,
  .filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    margin-bottom: 1rem;
  }

  .filterbar {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    max-width: 100%;
  }
  .filterbar input[type='search'] {
    width: 14rem;
    min-width: 0;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 8px;
    padding: 0.5rem 0.6rem;
    font: inherit;
    font-size: 0.85rem;
    color: var(--ink);
  }
  .filter-go {
    height: 38px;
    padding: 0 0.85rem;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.78rem;
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
    border: 1px solid var(--ink, var(--color-fg));
    border-radius: 8px;
    cursor: pointer;
  }

  .status-tabs {
    display: flex;
    padding: 0;
    border: 0;
    margin: 0;
    min-width: 0;
    gap: 4px;
    flex-wrap: wrap;
  }
  .status-tab {
    padding: 0.4rem 0.75rem;
    border-radius: 7px;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.78rem;
    color: var(--ink-2, var(--color-fg-muted));
    text-transform: capitalize;
    background: transparent;
    border: 1px solid var(--rule);
    cursor: pointer;
  }
  .count {
    margin-inline-start: 0.2rem;
    font-variant-numeric: tabular-nums;
  }
  .status-tab[aria-pressed='true'] {
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 8%,
      transparent
    );
    border-color: var(--ink-3);
    color: var(--ink);
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
    margin-left: auto;
    justify-content: flex-end;
  }
  .export-link {
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    border: 1px solid var(--rule, var(--color-border));
    padding: 0 0.7rem;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.76rem;
    text-decoration: none;
    background: var(--ink, var(--color-fg));
    border-color: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
  }
  .table-wrap {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 14px;
    box-shadow: var(--shadow-1, 0 1px 2px rgba(0, 0, 0, 0.04));
    overflow: hidden;
  }

  .kw-table {
    width: 100%;
    border-collapse: collapse;
    overflow-wrap: anywhere;
    font-size: 0.85rem;
  }
  .kw-table thead th {
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-3, var(--color-fg-muted));
    font-weight: 500;
    text-align: left;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--rule, var(--color-border));
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 80%,
      var(--paper-2, transparent)
    );
  }
  .kw-table tbody td {
    padding: 0.85rem;
    border-bottom: 1px solid var(--rule-2, var(--color-border));
    vertical-align: top;
  }
  .kw-table tbody tr:hover {
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 3%,
      transparent
    );
  }
  .col-word {
    width: 22%;
  }
  .col-pos {
    width: 8%;
    text-transform: lowercase;
  }
  .col-status {
    width: 14%;
  }
  .col-when {
    width: 14%;
    font-feature-settings: 'tnum';
  }
  .kw-word {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    line-height: 1.2;
    color: var(--ink, var(--color-fg));
  }
  .status {
    text-transform: capitalize;
    font-weight: 500;
    color: var(--ink-2);
  }
  .status[data-status='learning'] {
    color: color-mix(in oklch, var(--accent) 80%, var(--ink));
  }
  .status[data-status='known'] {
    color: color-mix(in oklch, var(--color-success) 70%, var(--ink));
  }

  @media (max-width: 639px) {
    .kw-table thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .kw-table tbody tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'word status'
        'pos updated'
        'definition definition';
      align-items: baseline;
      gap: 0.25rem 0.75rem;
      padding: 0.75rem;
    }
    .kw-table tbody tr + tr {
      border-top: 1px solid var(--rule-2);
    }
    .kw-table tbody td {
      width: auto;
      padding: 0;
      border: 0;
    }
    .col-word { grid-area: word; }
    .col-pos { grid-area: pos; }
    .col-def { grid-area: definition; }
    .col-status { grid-area: status; text-align: right; }
    .col-when { grid-area: updated; text-align: right; }
  }

  .muted {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .small {
    font-size: 0.78rem;
  }
  .empty {
    padding: 2rem 0;
    text-align: center;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .empty a {
    color: var(--accent-ink, var(--color-accent));
  }
</style>
