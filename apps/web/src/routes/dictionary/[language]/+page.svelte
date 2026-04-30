<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const pageNum = $derived(Math.floor(data.offset / data.limit) + 1);
  const totalPages = $derived(Math.max(1, Math.ceil(data.totalCount / data.limit)));
  const prevOffset = $derived(Math.max(0, data.offset - data.limit));
  const nextOffset = $derived(data.offset + data.limit);

  function hrefWith(offset: number): string {
    const params = new URLSearchParams();
    if (data.query.q) params.set('q', data.query.q);
    for (const p of data.query.pos) params.append('pos', p);
    if (data.query.hasOfficialTranslation) {
      params.set('hasOfficialTranslation', 'true');
    }
    if (offset > 0) params.set('offset', String(offset));
    if (data.limit !== 50) params.set('limit', String(data.limit));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }
</script>

<svelte:head>
  <title>{data.language.displayName} dictionary — CIA Reader</title>
  <meta
    name="description"
    content="Browse {data.language.displayName} lemmas, glosses, and translations in CIA Reader."
  />
</svelte:head>

<div class="page" dir={data.language.textDirection}>
  <header>
    <h1>
      {data.language.nativeName}
      <span class="muted">— {data.language.displayName} dictionary</span>
    </h1>
    <p class="sub">
      {data.totalCount.toLocaleString()} lemmas indexed
      {#if data.query.q}· matching <strong>{data.query.q}</strong>{/if}
    </p>
  </header>

  <form method="get" class="search">
    <input
      type="search"
      name="q"
      value={data.query.q}
      placeholder="Type a headword in {data.language.nativeName}…"
      aria-label="Search {data.language.displayName} headwords"
    />
    <label class="checkbox">
      <input
        type="checkbox"
        name="hasOfficialTranslation"
        value="true"
        checked={data.query.hasOfficialTranslation}
      />
      Only lemmas with an official translation
    </label>
    <button type="submit">Search</button>
  </form>

  {#if data.usedNuktaFallback}
    <!--
      #318: Nukta-agnostic fallback fired. Tell the user the strict
      match missed and we found these by ignoring nuktas — `ज़रा` and
      `जरा` collapse to the same key, so the user might be looking at
      a different word than they typed.
    -->
    <p class="nukta-fallback" role="status">
      No exact matches for <strong>{data.query.q}</strong> — showing
      nukta-agnostic results.
    </p>
  {/if}

  {#if data.lemmas.length === 0}
    <p class="empty">No lemmas match.</p>
  {:else}
    <ol class="lemmas">
      {#each data.lemmas as lemma (lemma.id)}
        <li>
          <div class="row">
            <span class="headword">{lemma.headword}</span>
            <span class="pos">{lemma.pos}</span>
            {#if lemma.frequencyRank != null}
              <span class="rank muted">#{lemma.frequencyRank}</span>
            {/if}
          </div>
          {#if lemma.glossDefault}
            <div class="gloss">{lemma.glossDefault}</div>
          {/if}
          {#if lemma.sourceAttribution}
            <div class="attrib muted">Source: {lemma.sourceAttribution}</div>
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
</div>

<style>
  .page {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  header h1 {
    margin: 0 0 0.25rem;
    font-size: 1.75rem;
  }
  .sub {
    margin: 0 0 1.5rem;
    color: var(--color-fg-muted);
    font-size: 0.95rem;
  }
  .muted {
    color: var(--color-fg-muted);
  }
  .search {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: 1fr auto;
    align-items: center;
    margin-bottom: 1.25rem;
  }
  .search input[type='search'] {
    grid-column: 1 / 2;
    padding: 0.6rem 0.75rem;
    font: inherit;
    min-height: 44px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
  }
  .search .checkbox {
    grid-column: 1 / 2;
    font-size: 0.9rem;
    color: var(--color-fg-muted);
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .search button {
    grid-column: 2 / 3;
    grid-row: 1 / 2;
    min-height: 44px;
    padding: 0 1rem;
    font: inherit;
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
  .rank {
    font-size: 0.8rem;
  }
  .gloss {
    margin-top: 0.25rem;
    color: var(--color-fg);
  }
  .attrib {
    margin-top: 0.15rem;
    font-size: 0.8rem;
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
