<!--
  Words manager (T-10.6).

  Lists the caller's vocabulary in a card-wrapped table on >=768px and
  collapses to a single-column list view on smaller viewports. Status
  filter tabs + search input + language picker hang off the URL so a
  filtered view is shareable and refresh-stable.
-->
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const STATUS_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'unknown', label: 'New' },
    { id: 'learning', label: 'Learning' },
    { id: 'known', label: 'Known' },
    { id: 'ignored', label: 'Ignored' },
  ] as const;

  const STATUS_LABEL: Record<string, string> = {
    unknown: 'New',
    learning: 'Learning',
    known: 'Known',
    ignored: 'Ignored',
  };

  function hrefWith(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams();
    if (data.filters.language) params.set('language', data.filters.language);
    if (data.filters.status !== 'all') params.set('status', data.filters.status);
    if (data.filters.q) params.set('q', data.filters.q);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function exportHref(language: string): string {
    return `/api/v1/me/vocabulary/export?language=${encodeURIComponent(language)}`;
  }

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
  <title>Words — CIA Reader</title>
</svelte:head>

<section class="content">
  <header class="topbar">
    <div>
      <h1 class="title">Words</h1>
      <p class="sub">
        {data.rows.length}{data.truncated ? '+' : ''} entries
        {#if data.filters.language}
          · {data.languages.find((l) => l.code === data.filters.language)
            ?.nativeName}
        {/if}
      </p>
    </div>

    <form method="get" class="filterbar">
      <div class="search">
        <input
          name="q"
          value={data.filters.q}
          placeholder="Search words, definitions…"
          autocomplete="off"
        />
      </div>
      {#if data.filters.language}
        <input
          type="hidden"
          name="language"
          value={data.filters.language}
        />
      {/if}
      {#if data.filters.status !== 'all'}
        <input type="hidden" name="status" value={data.filters.status} />
      {/if}
      <button class="filter-go" type="submit">Search</button>
    </form>
  </header>

  <nav class="status-tabs" aria-label="Status filter">
    {#each STATUS_FILTERS as t (t.id)}
      <a
        class="status-tab"
        data-active={data.filters.status === t.id ? '1' : '0'}
        href={hrefWith({ status: t.id === 'all' ? null : t.id })}
      >
        {t.label}
      </a>
    {/each}
  </nav>

  <div class="language-row" aria-label="Language filter">
    <a
      class="language-chip"
      data-active={data.filters.language === null ? '1' : '0'}
      href={hrefWith({ language: null })}
    >
      All
    </a>
    {#each data.languages as language (language.code)}
      <a
        class="language-chip"
        data-active={data.filters.language === language.code ? '1' : '0'}
        href={hrefWith({ language: language.code })}
      >
        {language.nativeName}
      </a>
    {/each}
    {#if data.filters.language}
      <a class="export-link" href={exportHref(data.filters.language)}>
        Export CSV
      </a>
    {/if}
  </div>

  {#if data.rows.length === 0}
    <p class="empty">
      {#if data.filters.q || data.filters.status !== 'all' || data.filters.language}
        No words match those filters. <a href={hrefWith({ q: null, status: null, language: null })}>Clear all</a>.
      {:else}
        You haven't marked any words yet. Open a text and click any word to
        add it to your vocabulary.
      {/if}
    </p>
  {:else}
    <div class="card kw-card">
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
                <div class="kw-word">{row.headword}</div>
                <div class="kw-lang">{row.language}</div>
              </td>
              <td class="col-pos muted">{row.pos}</td>
              <td class="col-def">
                {row.glossDefault ?? '—'}
              </td>
              <td class="col-status">
                <span class={`status-pill status-${row.status}`}>
                  <span class="dot" aria-hidden="true"></span>
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
              </td>
              <td class="col-when muted">{relativeFromNow(row.updatedAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <ul class="kw-list" aria-label="Vocabulary">
      {#each data.rows as row (row.lemmaId)}
        <li class="kw-item card">
          <div class="kw-item-l">
            <div class="kw-word">{row.headword}</div>
            <div class="kw-meta">
              <span class="muted small">{row.pos}</span>
              <span class="muted small">·</span>
              <span class="muted small">{row.language}</span>
              <span class="muted small">·</span>
              <span class="muted small">{relativeFromNow(row.updatedAt)}</span>
            </div>
            {#if row.glossDefault}
              <div class="kw-def">{row.glossDefault}</div>
            {/if}
          </div>
          <span class={`status-pill status-${row.status}`}>
            <span class="dot" aria-hidden="true"></span>
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
        </li>
      {/each}
    </ul>

    {#if data.truncated}
      <p class="empty muted small">
        Showing the most recently-updated 200 entries. Filter by language or
        status to narrow the list.
      </p>
    {/if}
  {/if}
</section>

<style>
  .content {
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.75rem 1.25rem 3rem;
  }
  @media (min-width: 768px) {
    .content {
      padding: 2.25rem 2rem 3.5rem;
    }
  }

  .topbar {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    align-items: end;
    margin-bottom: 0.85rem;
  }
  @media (min-width: 640px) {
    .topbar {
      grid-template-columns: 1fr auto;
    }
  }
  .title {
    font-family: var(--font-serif, var(--font-ui));
    font-weight: 600;
    font-size: 1.4rem;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--ink, var(--color-fg));
  }
  .sub {
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0.15rem 0 0;
    font-feature-settings: 'tnum';
  }

  .filterbar {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--paper, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    padding: 0 0.6rem;
  }
  .search input {
    background: transparent;
    border: 0;
    outline: 0;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.5rem 0;
    color: var(--ink, var(--color-fg));
    min-width: 14rem;
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
    display: inline-flex;
    gap: 4px;
    margin-bottom: 0.85rem;
    flex-wrap: wrap;
  }
  .status-tab {
    padding: 0.4rem 0.75rem;
    border-radius: 7px;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.78rem;
    color: var(--ink-2, var(--color-fg-muted));
    text-decoration: none;
  }
  .status-tab[data-active='1'] {
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 8%,
      transparent
    );
    color: var(--ink, var(--color-fg));
  }

  .language-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
    margin: -0.25rem 0 0.9rem;
  }
  .language-chip,
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
    color: var(--ink-2, var(--color-fg-muted));
    text-decoration: none;
    background: var(--paper, var(--color-bg));
  }
  .language-chip[data-active='1'] {
    border-color: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 22%,
      var(--rule, var(--color-border))
    );
    color: var(--ink, var(--color-fg));
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 6%,
      var(--paper, var(--color-bg))
    );
  }
  .export-link {
    margin-left: auto;
    background: var(--ink, var(--color-fg));
    border-color: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
  }
  @media (max-width: 560px) {
    .export-link {
      width: 100%;
      margin-left: 0;
    }
  }

  .card {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 14px;
    box-shadow: var(--shadow-1, 0 1px 2px rgba(0, 0, 0, 0.04));
    overflow: hidden;
  }

  /* Desktop table — visible at >=768px. */
  .kw-card {
    display: none;
  }
  @media (min-width: 768px) {
    .kw-card {
      display: block;
    }
    .kw-list {
      display: none;
    }
  }
  .kw-table {
    width: 100%;
    border-collapse: collapse;
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
  .kw-lang {
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.65rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin-top: 0.15rem;
    text-transform: uppercase;
  }

  /* Mobile list — visible at <768px. */
  .kw-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .kw-item {
    padding: 0.75rem 0.9rem;
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    justify-content: space-between;
  }
  .kw-item-l {
    flex: 1;
    min-width: 0;
  }
  .kw-meta {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-top: 0.2rem;
  }
  .kw-def {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: var(--ink-2, var(--color-fg));
    line-height: 1.4;
  }

  /* Status pill (table + list). */
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 22px;
    padding: 0 0.6rem;
    border-radius: 999px;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.7rem;
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 6%,
      transparent
    );
    color: var(--ink-2, var(--color-fg));
  }
  .status-pill .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .status-pill.status-unknown {
    background: var(--accent-soft, color-mix(in srgb, #b07a31 14%, transparent));
    color: var(--accent-ink, #b07a31);
  }
  .status-pill.status-learning {
    background: color-mix(in oklch, oklch(0.74 0.12 70) 30%, transparent);
    color: var(--accent-ink, #7d5e21);
  }
  .status-pill.status-known {
    background: var(--green-soft, color-mix(in srgb, #197a2f 14%, transparent));
    color: var(--green, #197a2f);
  }
  .status-pill.status-ignored {
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 8%,
      transparent
    );
    color: var(--ink-3, var(--color-fg-muted));
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
