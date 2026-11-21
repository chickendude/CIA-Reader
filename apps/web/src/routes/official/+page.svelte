<script lang="ts">
  import PageLayout from '$lib/components/shell/PageLayout.svelte';
  import PageTitle from '$lib/components/shell/PageTitle.svelte';
  import Pagination from '$lib/components/input/Pagination.svelte';
  import CoverageOrder from '$lib/components/library/CoverageOrder.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import BookMetrics from '$lib/components/library/BookMetrics.svelte';
  import BookActions from '$lib/components/library/BookActions.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  function pageHref(offset: number) {
    const url = new URL(page.url);
    url.searchParams.set('offset', String(offset));
    return url.pathname + url.search;
  }

  function setLanguage(code: string) {
    const url = new URL(typeof window !== 'undefined' ? window.location.href : 'http://x');
    if (code) url.searchParams.set('language', code);
    else url.searchParams.delete('language');
    url.searchParams.delete('offset');
    void goto(url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''));
  }
</script>

<svelte:head>
  <title>Official library | Parhiba</title>
  <meta
    name="description"
    content="Browse books in the Parhiba official library and compare vocabulary coverage."
  />
</svelte:head>

{#snippet heading()}
  <PageTitle>Official library</PageTitle>
{/snippet}

<PageLayout {heading}>
<div class="ol">
  <header class="ol-h">
    {@render heading()}
  </header>

  <div class="ol-filters">
    <label>
      <span class="ol-l">Language</span>
      <select
        value={data.language ?? ''}
        onchange={(e) => setLanguage((e.target as HTMLSelectElement).value)}
      >
        <option value="">All</option>
        {#each data.languages as lang}
          <option value={lang.code}>{lang.displayName}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if data.user}<CoverageOrder value={data.sort} />{/if}
  <ul class="ol-list">
    {#each data.page.cards as card (card.id)}
      <li class="ol-card">
        <div class="ol-card-body">
          <h2 class="ol-title"><a class="ol-card-a" href={card.chapterCount == null ? `/library/${card.id}` : `/collections/${card.id}`}>{card.title}</a></h2>
          <p class="ol-meta">
            <span class="ol-pill">{card.language}</span>
            <span class="ol-pill ol-pill-source">{card.sourceType}</span>
          </p>
          <BookMetrics stats={card.stats} signedIn={Boolean(data.user)} showUniqueCoverage={data.sort === 'unique'} />
        </div>
        {#if data.user?.role === 'admin'}
          <BookActions collection={card.chapterCount != null} id={card.id} title={card.title} canRename catalogAction="remove" />
        {/if}
      </li>
    {:else}
      <li class="ol-empty">No official texts yet for this language.</li>
    {/each}
  </ul>
  <Pagination offset={data.page.offset} limit={data.page.limit} total={data.page.totalCount} hrefFor={pageHref} />
</div>
</PageLayout>

<style>
  .ol-filters {
    margin-bottom: 1rem;
  }
  .ol-l {
    display: block;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin-bottom: 0.2rem;
  }
  select {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-size: 0.9rem;
  }
  .ol-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: 0.85rem;
  }
  .ol-card {
    position: relative;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 10px;
  }
  .ol-card-body { padding: 1rem 1.1rem; position: relative; isolation: isolate; }
  .ol-card-a::after { content: ''; position: absolute; inset: 0; z-index: 1; }
  .ol-card-a:focus-visible::after { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 10px; }
  .ol-card-a {
    text-decoration: none;
    color: inherit;
  }
  .ol-card:has(:global(.book-actions)) .ol-card-body { padding-right: 3.4rem; }
  .ol-card-body:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 4%, transparent);
  }
  .ol-title {
    font-family: var(--font-serif-dev, var(--font-serif));
    margin: 0 0 0.4rem;
    font-size: 1.05rem;
  }
  .ol-meta {
    display: flex;
    gap: 0.4rem;
    margin: 0;
  }
  .ol-pill {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    border-radius: 999px;
    padding: 0.18rem 0.5rem;
    font-size: 0.62rem;
    color: var(--ink-3, var(--color-fg-muted));
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .ol-empty {
    padding: 2rem;
    text-align: center;
    color: var(--ink-3, var(--color-fg-muted));
    font-style: italic;
  }
</style>
