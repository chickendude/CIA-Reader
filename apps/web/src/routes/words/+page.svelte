<script lang="ts">
  import PageLayout from '$lib/components/shell/PageLayout.svelte';
  import PageTitle from '$lib/components/shell/PageTitle.svelte';
  import '$lib/styles/entry-table.css';
  import { beforeNavigate, goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import Pagination from '$lib/components/input/Pagination.svelte';
  import Button from '$lib/components/input/Button.svelte';
  import TextField from '$lib/components/input/TextField.svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';
  import { encodeStatuses, WORD_STATUSES, type WordStatus } from './word-statuses';

  let { data }: PageProps = $props();
  const selected = $derived(data.filters.statuses);
  const allSelected = $derived(selected.length === WORD_STATUSES.length);
  let saving = $state(false);

  let draft = $state<string | null>(null);
  const query = $derived(draft ?? data.filters.q);
  let timer: ReturnType<typeof setTimeout>;
  let composing = false;
  let searchVersion = 0;

  beforeNavigate(({ type }) => {
    if (type === 'link' || type === 'popstate') {
      clearTimeout(timer);
      searchVersion++;
      draft = null;
    }
  });
  onDestroy(() => clearTimeout(timer));

  function wordsHref(offset: number, status = encodeStatuses(selected), text = data.filters.q) {
    const params = new URLSearchParams({ status });
    if (text.trim()) params.set('q', text.trim());
    if (offset) params.set('offset', String(offset));
    return `/words?${params}`;
  }

  async function search(status = encodeStatuses(selected)) {
    clearTimeout(timer);
    const version = ++searchVersion;
    const text = query;
    await goto(wordsHref(0, status, text), { replaceState: true, keepFocus: true, noScroll: true });
    if (version === searchVersion && draft === text && text === text.trim()) draft = null;
  }

  function queueSearch(value: string) {
    draft = value;
    clearTimeout(timer);
    if (composing || saving) return;
    if (value) timer = setTimeout(() => void search(), 200);
    else void search();
  }

  function toggleValue(status: WordStatus): string {
    const next = selected.includes(status)
      ? selected.filter((item) => item !== status)
      : [...selected, status];
    return encodeStatuses(next);
  }

  const saveSelection: SubmitFunction = () => {
    clearTimeout(timer);
    saving = true;
    return async ({ result, update }) => {
      try {
        if (result.type === 'redirect' && result.status === 303 && result.location.startsWith('/words?')) {
          const status = new URL(result.location, window.location.href).searchParams.get('status');
          if (status) await search(status);
        } else {
          await update();
        }
      } finally {
        saving = false;
        if (draft !== null && draft.trim() !== data.filters.q) queueSearch(draft);
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

{#snippet heading()}
  <PageTitle>Words</PageTitle>
{/snippet}

<PageLayout {heading}>
<section class="content">
  <header class="topbar">
    {@render heading()}
    <div class="actions">
      <Button variant="primary" href={`/api/v1/me/vocabulary/export?language=${data.filters.language}`}>Export CSV</Button>
      <Button variant="primary" href="/words/anki/import">Import from Anki</Button>
      <Button variant="primary" href="/words/anki">Export to Anki</Button>
    </div>
  </header>

  <div class="filters">
    <form method="post" action="?/filter" use:enhance={saveSelection}>
      <input type="hidden" name="q" value={query} />
      <fieldset class="status-tabs" disabled={saving} aria-label="Word statuses">
        <Button
          type="submit" variant="toggle"
          name="status"
          value={allSelected ? 'none' : 'all'}
          aria-pressed={allSelected ? true : selected.length ? 'mixed' : false}
        >All</Button>
        {#each WORD_STATUSES as status (status)}
          <Button
            type="submit" variant="toggle"
            name="status"
            value={toggleValue(status)}
            aria-pressed={selected.includes(status)}
          >
            {status} <span class="count">{data.counts[status].toLocaleString()}</span>
          </Button>
        {/each}
      </fieldset>
    </form>

    <form method="get" class="filterbar" role="search" onsubmit={(event) => {
      event.preventDefault();
      if (!saving && !composing) void search();
    }}>
      <TextField
        type="search"
        name="q"
        bind:value={() => query, queueSearch}
        oncompositionstart={() => { composing = true; clearTimeout(timer); }}
        oncompositionend={(event) => { composing = false; queueSearch(event.currentTarget.value); }}
        aria-label="Search words and definitions"
        placeholder="Search words and definitions"
        autocomplete="off"
      />
      <input type="hidden" name="status" value={encodeStatuses(selected)} />
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
    <div class="entry-table-wrap">
      <table class="entry-table" aria-label="Vocabulary">
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
                {row.definition ?? ''}
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
  {/if}
  <Pagination {...data.pagination} hrefFor={wordsHref} />
</section>
</PageLayout>

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
    width: min(20rem, 100%);
    font-size: 0.85rem;
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
  .count {
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
    margin-left: auto;
    justify-content: flex-end;
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
    .entry-table thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .entry-table tbody tr {
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
    .entry-table tbody tr + tr {
      border-top: 1px solid var(--rule-2);
    }
    .entry-table tbody td {
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
  .empty {
    padding: 2rem 0;
    text-align: center;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .empty a {
    color: var(--accent-ink, var(--color-accent));
  }
</style>
