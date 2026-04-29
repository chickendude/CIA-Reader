<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function setLanguage(code: string) {
    const url = new URL(typeof window !== 'undefined' ? window.location.href : 'http://x');
    if (code) url.searchParams.set('language', code);
    else url.searchParams.delete('language');
    url.searchParams.delete('offset');
    void goto(url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''));
  }
</script>

<svelte:head>
  <title>Official library — CIA Reader</title>
  <meta
    name="description"
    content="Browse the official library of Hindi, Marathi, and Odia texts curated for the CIA Reader — every text comes with lemma-aware reading, romanization, and shared dictionary entries."
  />
</svelte:head>

<div class="ol">
  <header class="ol-h">
    <h1>Official library</h1>
    <p class="ol-h-sub">
      Curator-promoted texts. Anyone can read; sign in to track known
      words across visits.
    </p>
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

  <ul class="ol-list">
    {#each data.page.cards as card (card.id)}
      <li class="ol-card">
        <a href={`/reader/${card.id}`} class="ol-card-a">
          <h2 class="ol-title">{card.title}</h2>
          <p class="ol-meta">
            <span class="ol-pill">{card.language}</span>
            <span class="ol-pill ol-pill-source">{card.sourceType}</span>
          </p>
        </a>
      </li>
    {:else}
      <li class="ol-empty">No official texts yet for this language.</li>
    {/each}
  </ul>
</div>

<style>
  .ol {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    color: var(--ink, var(--color-fg));
  }
  .ol-h h1 {
    margin: 0 0 0.2rem;
    font-size: 1.6rem;
    font-family: var(--font-serif, system-ui);
  }
  .ol-h-sub {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.9rem;
    margin: 0 0 1.4rem;
  }
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
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 10px;
  }
  .ol-card-a {
    display: block;
    padding: 1rem 1.1rem;
    text-decoration: none;
    color: inherit;
  }
  .ol-card-a:hover {
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
