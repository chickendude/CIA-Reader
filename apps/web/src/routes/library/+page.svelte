<!--
  Library (T-4.5 → T-5.13).

  The data flow is unchanged: tabs (Your / Shared / Official), language
  filter, offset pagination. The CIAR design replaces the inline list
  with a card grid — cover gradients picked deterministically per
  text id (so a user's library doesn't reshuffle), kind tag (book vs
  single — single for everything until M8 collections), status badge,
  and a leading "Add a text" tile on the Your tab.
-->
<script lang="ts">
  import { coverForId } from '$lib/components/library/cover.js';
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
    { id: 'your', label: 'Yours', requiresAuth: true },
    { id: 'shared', label: 'Shared', requiresAuth: true },
    { id: 'collections', label: 'Collections', requiresAuth: false },
    { id: 'official', label: 'Official', requiresAuth: false },
  ] as const;
</script>

<svelte:head>
  <title>Library — CIA Reader</title>
</svelte:head>

<section class="content">
  <header class="topbar">
    <div>
      <h1 class="title">Library</h1>
      <p class="sub">
        {#if data.tab === 'your'}
          Your imported texts.
        {:else if data.tab === 'shared'}
          Texts other users have shared with you.
        {:else}
          Curated texts for every learner.
        {/if}
      </p>
    </div>

    <nav class="status-tabs" aria-label="Library tabs">
      {#each TABS as t (t.id)}
        {#if !t.requiresAuth || data.isAuthenticated}
          <a
            class="status-tab"
            data-active={data.tab === t.id ? '1' : '0'}
            href={hrefWith({ tab: t.id, offset: null })}
          >
            {t.label}
          </a>
        {/if}
      {/each}
    </nav>
  </header>

  <form method="get" class="filters">
    <input type="hidden" name="tab" value={data.tab} />
    <label>
      <span class="filter-label">Language</span>
      <select name="language">
        <option value="">All languages</option>
        {#each data.languages as lang (lang.code)}
          <option value={lang.code} selected={data.language === lang.code}>
            {lang.displayName} ({lang.nativeName})
          </option>
        {/each}
      </select>
    </label>
    <button type="submit" class="filter-go">Filter</button>
  </form>

  <div class="lib-grid">
    {#if data.tab === 'your' && data.isAuthenticated}
      <a class="card upload-card" href="/upload">
        <div class="upload-card-body">
          <div class="big" aria-hidden="true">+</div>
          <div class="label">Add a text or EPUB</div>
          <div class="sub">.txt, .epub, .html, paste from clipboard</div>
        </div>
      </a>
    {/if}
    {#if data.tab === 'collections' && data.isAuthenticated}
      <a class="card upload-card" href="/collections/new">
        <div class="upload-card-body">
          <div class="big" aria-hidden="true">+</div>
          <div class="label">New collection</div>
          <div class="sub">Chapter book, course, or anthology</div>
        </div>
      </a>
    {/if}

    {#if data.tab === 'collections'}
      {#each data.collections as col (col.id)}
        <a class="card lib-card" href={`/collections/${col.id}`}>
          <div class={`lib-cover cover-${coverForId(col.id)}`}>
            <div class="cover-title">{col.title}</div>
            <div class="cover-chips">
              <span class="chip">{col.kind}</span>
              {#if col.visibility !== 'private'}
                <span class="chip">{col.visibility}</span>
              {/if}
              {#if col.estimatedComprehensionPct !== null}
                <span class="chip chip-pct" title="Estimated comprehension">
                  {col.estimatedComprehensionPct}% known
                </span>
              {/if}
            </div>
          </div>
          <div class="body">
            <div class="kind-row">
              <span class="kind-tag">collection</span>
              <span class="kind-meta">{col.textCount} {col.textCount === 1 ? 'text' : 'texts'}</span>
            </div>
            <div class="title-dev">{col.title}</div>
          </div>
        </a>
      {/each}
    {:else}
      {#each data.page.cards as card (card.id)}
        {@const pct = data.textComprehension?.[card.id] ?? null}
        <a class="card lib-card" href={`/reader/${card.id}`}>
          <div class={`lib-cover cover-${coverForId(card.id)}`}>
            <div class="cover-title">{card.title}</div>
            <div class="cover-chips">
              <span class="chip status-{card.status}">{card.status}</span>
              {#if card.visibility !== 'private'}
                <span class="chip">{card.visibility}</span>
              {/if}
              {#if pct !== null}
                <span class="chip chip-pct" title="Estimated comprehension">
                  {pct}% known
                </span>
              {/if}
            </div>
          </div>
          <div class="body">
            <div class="kind-row">
              <span class="kind-tag">{card.sourceType}</span>
              <span class="kind-meta">{card.language}</span>
            </div>
            <div class="title-dev">{card.title}</div>
          </div>
        </a>
      {/each}
    {/if}
  </div>

  {#if data.tab === 'collections' ? data.collections.length === 0 : data.page.cards.length === 0}
    <p class="empty">
      {#if data.tab === 'your'}
        You haven't uploaded any texts yet — try the
        <a href="/upload">+ Add a text</a> tile above.
      {:else if data.tab === 'shared'}
        No shared texts yet. Sharing lands in a future ticket.
      {:else if data.tab === 'collections'}
        No collections yet.
        {#if data.isAuthenticated}
          Try the <a href="/collections/new">+ New collection</a> tile above.
        {/if}
      {:else}
        No official texts yet. Curators are working on it.
      {/if}
    </p>
  {/if}

  {#if data.page.cards.length > 0}
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
    margin-bottom: 1rem;
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
  }

  /* Pill tabs (matches the design's status-tabs treatment used in
     reader / words / settings). */
  .status-tabs {
    display: inline-flex;
    gap: 4px;
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

  .filters {
    display: flex;
    align-items: end;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .filters label {
    flex: 1;
    max-width: 18rem;
  }
  .filter-label {
    display: block;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-3, var(--color-fg-muted));
    margin-bottom: 0.25rem;
  }
  .filters select {
    display: block;
    width: 100%;
    padding: 0.45rem 0.65rem;
    font: inherit;
    font-size: 0.85rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    min-height: 36px;
  }
  .filter-go {
    height: 36px;
    padding: 0 0.85rem;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.78rem;
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
    border: 1px solid var(--ink, var(--color-fg));
    border-radius: 8px;
    cursor: pointer;
  }

  .lib-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
  }

  .card {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 14px;
    box-shadow: var(--shadow-1, 0 1px 2px rgba(0, 0, 0, 0.04));
    color: inherit;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition:
      transform 150ms ease,
      border-color 150ms ease,
      box-shadow 150ms ease;
  }
  .card:hover {
    transform: translateY(-2px);
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 40%,
      var(--card-edge, var(--color-border))
    );
    box-shadow: var(--shadow-2, 0 8px 20px rgba(0, 0, 0, 0.08));
  }

  /* Cover gradients — one of seven, picked by hash(id). */
  .lib-cover {
    height: 140px;
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--card-edge, var(--color-border));
  }
  .cover-title {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    text-align: center;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.6rem;
    line-height: 1.05;
    padding: 0.75rem;
    color: var(--ink, var(--color-fg));
  }
  .cover-chips {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 0.55rem;
    border-radius: 999px;
    font-size: 0.66rem;
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 80%,
      transparent
    );
  }
  .chip-pct {
    background: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 22%,
      var(--paper, var(--color-bg))
    );
    color: var(--accent-ink, var(--ink, var(--color-fg)));
    font-feature-settings: 'tnum';
    color: var(--ink-2, var(--color-fg));
    backdrop-filter: blur(4px);
  }
  .chip.status-ready {
    background: var(--green-soft, color-mix(in srgb, #197a2f 20%, transparent));
    color: var(--green, #197a2f);
  }
  .chip.status-failed {
    background: var(--rose-soft, color-mix(in srgb, #b03131 20%, transparent));
    color: var(--rose, #b03131);
  }
  .chip.status-processing,
  .chip.status-pending {
    background: var(--accent-soft, color-mix(in srgb, #b07a31 20%, transparent));
    color: var(--accent-ink, #b07a31);
  }

  .cover-saffron {
    background: radial-gradient(
      140% 80% at 30% 20%,
      oklch(0.86 0.12 75) 0%,
      oklch(0.74 0.14 60) 100%
    );
  }
  .cover-olive {
    background: radial-gradient(
      140% 80% at 30% 20%,
      oklch(0.84 0.07 110) 0%,
      oklch(0.65 0.1 130) 100%
    );
  }
  .cover-rose {
    background: radial-gradient(
      140% 80% at 30% 20%,
      oklch(0.86 0.07 25) 0%,
      oklch(0.66 0.12 20) 100%
    );
  }
  .cover-indigo {
    background: radial-gradient(
      140% 80% at 30% 20%,
      oklch(0.78 0.06 270) 0%,
      oklch(0.5 0.1 270) 100%
    );
    color: var(--paper, var(--color-bg));
  }
  .cover-indigo .cover-title {
    color: var(--paper, var(--color-bg));
  }
  .cover-sepia {
    background: radial-gradient(
      140% 80% at 30% 20%,
      oklch(0.86 0.05 80) 0%,
      oklch(0.64 0.06 65) 100%
    );
  }
  .cover-paper {
    background: repeating-linear-gradient(
      180deg,
      var(--paper-2, #f7f1e2) 0 22px,
      var(--paper, #fdfaf3) 22px 23px
    );
  }
  .cover-plain {
    background: var(--paper-2, #f7f1e2);
  }

  .body {
    padding: 0.9rem 1rem 1rem;
  }
  .kind-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .kind-tag {
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3, var(--color-fg-muted));
    font-weight: 500;
  }
  .kind-meta {
    font-size: 0.65rem;
    color: var(--ink-3, var(--color-fg-muted));
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .title-dev {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    line-height: 1.3;
    color: var(--ink, var(--color-fg));
  }

  /* Upload tile — dashed-border invitation matching the design. */
  .upload-card {
    border-style: dashed;
    border-width: 1.5px;
    background: transparent;
    min-height: 16rem;
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .upload-card:hover {
    color: var(--ink, var(--color-fg));
    border-color: var(--accent, var(--color-accent));
  }
  .upload-card .big {
    font-size: 1.85rem;
    line-height: 1;
    margin-bottom: 0.75rem;
  }
  .upload-card .label {
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.85rem;
  }
  .upload-card .sub {
    font-size: 0.72rem;
    color: var(--ink-4, var(--color-fg-subtle));
    margin-top: 0.25rem;
  }

  .empty {
    color: var(--ink-3, var(--color-fg-muted));
    padding: 2rem 0;
    text-align: center;
  }
  .empty a {
    color: var(--accent-ink, var(--color-accent));
  }

  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 1.75rem;
    font-size: 0.85rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .page-links a {
    color: var(--accent-ink, var(--color-accent));
    text-decoration: none;
    margin-left: 0.85rem;
  }
</style>
