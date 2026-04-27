<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const pageNum = $derived(Math.floor(data.page.offset / data.page.limit) + 1);
  const totalPages = $derived(
    Math.max(1, Math.ceil(data.page.totalCount / data.page.limit)),
  );
  const prevOffset = $derived(Math.max(0, data.page.offset - data.page.limit));
  const nextOffset = $derived(data.page.offset + data.page.limit);

  function hrefWith(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams();
    params.set('tab', data.tab);
    if (data.language) params.set('language', data.language);
    if (data.page.offset > 0) params.set('offset', String(data.page.offset));
    if (data.page.limit !== 20) params.set('limit', String(data.page.limit));
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  const TABS = [
    { id: 'your', label: 'Your texts', requiresAuth: true },
    { id: 'shared', label: 'Shared with you', requiresAuth: true },
    { id: 'official', label: 'Official', requiresAuth: false },
  ] as const;
</script>

<svelte:head>
  <title>Library — CIA Reader</title>
</svelte:head>

<div class="page">
  <header>
    <h1>Library</h1>
    <p class="sub">
      {#if data.tab === 'your'}
        Your imported texts.
      {:else if data.tab === 'shared'}
        Texts other users have shared with you.
      {:else}
        Curated texts for every learner.
      {/if}
    </p>
  </header>

  <nav class="tabs" aria-label="Library tabs">
    {#each TABS as t (t.id)}
      {#if !t.requiresAuth || data.isAuthenticated}
        <a
          class:active={data.tab === t.id}
          href={hrefWith({ tab: t.id, offset: null })}
        >
          {t.label}
        </a>
      {/if}
    {/each}
  </nav>

  <form method="get" class="filters">
    <input type="hidden" name="tab" value={data.tab} />
    <label>
      Language
      <select name="language">
        <option value="">All languages</option>
        {#each data.languages as lang (lang.code)}
          <option value={lang.code} selected={data.language === lang.code}>
            {lang.displayName} ({lang.nativeName})
          </option>
        {/each}
      </select>
    </label>
    <button type="submit">Filter</button>
  </form>

  {#if data.page.cards.length === 0}
    <p class="empty">
      {#if data.tab === 'your'}
        You haven't uploaded any texts yet. <a href="/upload">Upload one →</a>
      {:else if data.tab === 'shared'}
        No shared texts yet. Sharing lands in a future ticket.
      {:else}
        No official texts yet. Curators are working on it.
      {/if}
    </p>
  {:else}
    <ul class="cards">
      {#each data.page.cards as card (card.id)}
        <li>
          <a class="card" href={`/texts/${card.id}`}>
            <div class="card-title">{card.title}</div>
            <div class="card-meta">
              <span class="badge">{card.language}</span>
              <span class="badge">{card.sourceType}</span>
              <span class="badge status-{card.status}">{card.status}</span>
              <span class="badge">{card.visibility}</span>
            </div>
          </a>
        </li>
      {/each}
    </ul>

    <nav class="pager" aria-label="Pagination">
      <span class="page-info">
        Page {pageNum} of {totalPages}
        ({data.page.totalCount.toLocaleString()} total)
      </span>
      <span class="page-links">
        {#if data.page.offset > 0}
          <a href={hrefWith({ offset: prevOffset > 0 ? String(prevOffset) : null })}>
            ← Previous
          </a>
        {/if}
        {#if nextOffset < data.page.totalCount}
          <a href={hrefWith({ offset: String(nextOffset) })}>Next →</a>
        {/if}
      </span>
    </nav>
  {/if}
</div>

<style>
  .page {
    max-width: 50rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  header h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
  }
  .sub {
    color: var(--color-fg-muted);
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 1rem;
  }
  .tabs a {
    padding: 0.5rem 0.9rem;
    color: var(--color-fg-muted);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs a.active {
    color: var(--color-fg);
    border-bottom-color: var(--color-accent);
    font-weight: 600;
  }
  .filters {
    display: flex;
    gap: 0.5rem;
    align-items: end;
    margin-bottom: 1rem;
  }
  .filters label {
    flex: 1;
    font-size: 0.85rem;
    color: var(--color-fg-muted);
  }
  .filters select {
    display: block;
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.4rem 0.5rem;
    font: inherit;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    min-height: 40px;
  }
  .filters button {
    min-height: 40px;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .empty {
    color: var(--color-fg-muted);
    padding: 2rem 0;
    text-align: center;
  }
  .cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.75rem;
  }
  .card {
    display: block;
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    color: var(--color-fg);
    text-decoration: none;
    background: var(--color-bg);
    transition: border-color 120ms ease;
  }
  .card:hover {
    border-color: var(--color-accent);
  }
  .card-title {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.35rem;
  }
  .card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
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
  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 1.5rem;
    font-size: 0.9rem;
    color: var(--color-fg-muted);
  }
  .page-links a {
    color: var(--color-accent);
    text-decoration: none;
    margin-left: 0.75rem;
  }
</style>
