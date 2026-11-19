<script lang="ts">
  import Pagination from '$lib/components/input/Pagination.svelte';
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();


  function hrefWith(offset: number): string {
    const params = new URLSearchParams();
    if (data.language) params.set('language', data.language.code);
    if (data.query.q) params.set('q', data.query.q);
    if (offset > 0) params.set('offset', String(offset));
    if (data.limit !== 50) params.set('limit', String(data.limit));
    const qs = params.toString();
    return qs ? `?${qs}` : '/moderation/dictionary';
  }
</script>

<svelte:head>
  <title>Dictionary moderation | Parhiba</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header>
    <h1 class="page-title">Dictionary moderation</h1>
    {#if data.language}
      <p class="sub">
        Editing <strong>{data.language.nativeName}</strong> —
        {data.totalCount.toLocaleString()} lemmas
      </p>
    {:else}
      <p class="sub">No language grants. Ask an admin for curator rights.</p>
    {/if}
    <nav class="mod-nav" aria-label="Moderation sections">
      <a href="/moderation/hindi/workshop">Hindi dictionary workshop</a>
      <a href="/moderation/hindi">Hindi unparsed words and context review →</a>
      <a href="/moderation/translations">Translation reports →</a>
      <a href="/moderation/parses">Parse reports →</a>
      <a href="/moderation/transcribe">Transcribe →</a>
      <a href="/moderation/stats">Stats →</a>
      {#if data.isAdmin}
        <a href="/moderation/dictionary/bulk">Bulk tools →</a>
        <a href="/moderation/dictionary/sources">Sources →</a>
        <a href="/moderation/paradigms">Paradigms →</a>
      {/if}
    </nav>
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

    {#if data.usedNuktaFallback}
      <p class="nukta-fallback" role="status">
        No exact matches for <strong>{data.query.q}</strong> — showing
        nukta-agnostic results.
      </p>
    {/if}

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

    {/if}
    <Pagination offset={data.offset} limit={data.limit} total={data.totalCount} hrefFor={hrefWith} />
  {/if}
</div>

<style>
  .sub {
    margin: 0 0 1.25rem;
    color: var(--color-fg-muted);
  }
  .muted {
    color: var(--color-fg-muted);
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
  .nukta-fallback {
    margin: 0 0 1rem;
    padding: 0.6rem 0.85rem;
    border-radius: 6px;
    background: var(--color-info-bg, #eef5ff);
    color: var(--color-info-fg, var(--color-fg));
    border-left: 3px solid var(--color-accent);
    font-size: 0.9rem;
  }
</style>
