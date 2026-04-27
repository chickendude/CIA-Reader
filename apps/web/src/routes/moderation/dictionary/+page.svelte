<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const pageNum = $derived(Math.floor(data.offset / data.limit) + 1);
  const totalPages = $derived(Math.max(1, Math.ceil(data.totalCount / data.limit)));
  const prevOffset = $derived(Math.max(0, data.offset - data.limit));
  const nextOffset = $derived(data.offset + data.limit);

  function hrefWith(offset: number): string {
    const params = new URLSearchParams();
    if (data.language) params.set('language', data.language.code);
    if (data.query.q) params.set('q', data.query.q);
    if (offset > 0) params.set('offset', String(offset));
    if (data.limit !== 50) params.set('limit', String(data.limit));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }
</script>

<svelte:head>
  <title>Dictionary moderation — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header>
    <h1>Dictionary moderation</h1>
    {#if data.language}
      <p class="sub">
        Editing <strong>{data.language.nativeName}</strong> —
        {data.totalCount.toLocaleString()} lemmas
      </p>
    {:else}
      <p class="sub">No language grants. Ask an admin for curator rights.</p>
    {/if}
  </header>

  {#if data.descriptors.length > 1}
    <nav class="lang-picker" aria-label="Language">
      {#each data.descriptors as d (d.code)}
        <a
          class:active={data.language?.code === d.code}
          href={`?language=${d.code}`}
        >
          {d.displayName}
        </a>
      {/each}
    </nav>
  {/if}

  {#if data.language}
    <form method="get" class="search">
      <input type="hidden" name="language" value={data.language.code} />
      <input
        type="search"
        name="q"
        value={data.query.q}
        placeholder="Search {data.language.nativeName} headwords…"
        aria-label="Search"
      />
      <button type="submit">Search</button>
    </form>

    {#if data.lemmas.length === 0}
      <p class="empty">No lemmas match.</p>
    {:else}
      <ol class="lemmas" dir={data.language.textDirection}>
        {#each data.lemmas as lemma (lemma.id)}
          <li>
            <a class="row" href={`/moderation/dictionary/${lemma.id}`}>
              <span class="headword">{lemma.headword}</span>
              <span class="pos">{lemma.pos}</span>
              {#if lemma.curatorLocked}
                <span class="badge">locked</span>
              {/if}
              {#if lemma.frequencyRank != null}
                <span class="rank muted">#{lemma.frequencyRank}</span>
              {/if}
            </a>
            {#if lemma.glossDefault}
              <div class="gloss">{lemma.glossDefault}</div>
            {/if}
          </li>
        {/each}
      </ol>

      <nav class="pager" aria-label="Pagination">
        {#if data.offset > 0}
          <a rel="prev" href={hrefWith(prevOffset)}>← Previous</a>
        {:else}
          <span class="muted">← Previous</span>
        {/if}
        <span class="muted">Page {pageNum} of {totalPages}</span>
        {#if nextOffset < data.totalCount}
          <a rel="next" href={hrefWith(nextOffset)}>Next →</a>
        {:else}
          <span class="muted">Next →</span>
        {/if}
      </nav>
    {/if}
  {/if}
</div>

<style>
  .page {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
  }
  .sub {
    margin: 0 0 1.25rem;
    color: var(--color-fg-muted);
  }
  .muted {
    color: var(--color-fg-muted);
  }
  .lang-picker {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .lang-picker a {
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-fg);
    text-decoration: none;
    font-size: 0.9rem;
  }
  .lang-picker a.active {
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border-color: transparent;
  }
  .search {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: 1fr auto;
    margin-bottom: 1.25rem;
  }
  .search input[type='search'] {
    padding: 0.6rem 0.75rem;
    font: inherit;
    min-height: 44px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
  }
  .search button {
    min-height: 44px;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .lemmas {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .lemmas li {
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    text-decoration: none;
    color: var(--color-fg);
  }
  .row:hover .headword {
    text-decoration: underline;
  }
  .headword {
    font-size: 1.2rem;
    font-weight: 500;
  }
  .pos {
    font-size: 0.85rem;
    color: var(--color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--color-border);
    color: var(--color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .rank {
    font-size: 0.8rem;
  }
  .gloss {
    margin-top: 0.25rem;
  }
  .empty {
    margin: 2rem 0;
    color: var(--color-fg-muted);
  }
  .pager {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }
  .pager a {
    color: var(--color-accent);
  }
</style>
