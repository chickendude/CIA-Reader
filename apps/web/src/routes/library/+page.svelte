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
  import { invalidateAll } from '$app/navigation';
  import { coverForId } from '$lib/components/library/cover.js';
  import Modal from '$lib/components/overlay/Modal.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Shared confirm-delete modal — used for both text cards and
  // chapter-book collection cards. Native browser confirm() doesn't
  // match the rest of the app's visual language (see
  // feedback_ui_contrast: filled accent surfaces, focus traps, etc.).
  let pendingDelete = $state<{
    kind: 'text' | 'collection';
    id: string;
    title: string;
  } | null>(null);
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  function askDeleteText(id: string, title: string) {
    pendingDelete = { kind: 'text', id, title };
    deleteError = null;
  }
  function askDeleteCollection(id: string, title: string) {
    pendingDelete = { kind: 'collection', id, title };
    deleteError = null;
  }
  function closeDelete() {
    if (deleting) return;
    pendingDelete = null;
    deleteError = null;
  }
  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    deleting = true;
    deleteError = null;
    try {
      const url =
        pendingDelete.kind === 'text'
          ? `/api/v1/texts/${pendingDelete.id}`
          : `/api/v1/collections/${pendingDelete.id}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        deleteError =
          (await res.text().catch(() => '')) || `HTTP ${res.status}`;
        return;
      }
      pendingDelete = null;
      await invalidateAll();
    } finally {
      deleting = false;
    }
  }

  const activePage = $derived(
    data.tab === 'collections' ? data.collectionsPage : data.page,
  );
  const visibleCount = $derived(
    data.tab === 'collections' ? data.collections.length : data.page.cards.length,
  );
  const pageNum = $derived(Math.floor(activePage.offset / activePage.limit) + 1);
  const totalPages = $derived(
    Math.max(1, Math.ceil(activePage.totalCount / activePage.limit)),
  );
  const prevOffset = $derived(Math.max(0, activePage.offset - activePage.limit));
  const nextOffset = $derived(activePage.offset + activePage.limit);

  function hrefWith(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams();
    params.set('tab', data.tab);
    if (data.language) params.set('language', data.language);
    if (activePage.offset > 0) params.set('offset', String(activePage.offset));
    if (activePage.limit !== 20) params.set('limit', String(activePage.limit));
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
      <a
        class="card upload-card"
        href={data.language ? `/upload?language=${data.language}` : '/upload'}
      >
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
      {#each data.chapterBookCards as col (col.id)}
        <div class="lib-card-wrap">
          <a class="card lib-card" href={`/collections/${col.id}`}>
            <div class={`lib-cover cover-${coverForId(col.id)}`}>
              <div class="cover-title">{col.title}</div>
              <div class="cover-chips">
                <span class="chip">chapter book</span>
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
                <span class="kind-tag">book</span>
                <span class="kind-meta">{col.textCount} {col.textCount === 1 ? 'chapter' : 'chapters'}</span>
              </div>
              <div class="title-dev">{col.title}</div>
            </div>
          </a>
          {#if data.tab === 'your'}
            <button
              type="button"
              class="lib-card-del"
              aria-label="Delete {col.title}"
              title="Delete"
              onclick={() => askDeleteCollection(col.id, col.title)}
            >×</button>
          {/if}
        </div>
      {/each}
      {#each data.page.cards as card (card.id)}
        {@const pct = data.textComprehension?.[card.id] ?? null}
        <div class="lib-card-wrap">
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
          {#if data.tab === 'your'}
            <button
              type="button"
              class="lib-card-del"
              aria-label="Delete {card.title}"
              title="Delete"
              onclick={() => askDeleteText(card.id, card.title)}
            >×</button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  {#if data.tab === 'collections' ? data.collections.length === 0 : data.page.cards.length === 0 && data.chapterBookCards.length === 0}
    <p class="empty">
      {#if data.tab === 'your'}
        You haven't uploaded any texts yet — try the
        <a href={data.language ? `/upload?language=${data.language}` : '/upload'}
          >+ Add a text</a
        > tile above.
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

  {#if visibleCount > 0}
    <nav class="pager" aria-label="Pagination">
      <span class="page-info">
        Page {pageNum} of {totalPages}
        ({activePage.totalCount.toLocaleString()} total)
      </span>
      <span class="page-links">
        {#if activePage.offset > 0}
          <a href={hrefWith({ offset: prevOffset > 0 ? String(prevOffset) : null })}>
            ← Previous
          </a>
        {/if}
        {#if nextOffset < activePage.totalCount}
          <a href={hrefWith({ offset: String(nextOffset) })}>Next →</a>
        {/if}
      </span>
    </nav>
  {/if}
</section>

<Modal
  open={pendingDelete !== null}
  onClose={closeDelete}
  title={pendingDelete?.kind === 'collection' ? 'Delete chapter book' : 'Delete text'}
  width={420}
>
  {#if pendingDelete}
    <p class="del-body">
      Delete <strong>“{pendingDelete.title}”</strong>?
      {#if pendingDelete.kind === 'collection'}
        Every chapter, its tokens, audio, and progress goes with it.
      {:else}
        This removes the text, its chapters, tokens, audio, and
        progress.
      {/if}
      It can't be undone.
    </p>
    {#if deleteError}
      <p class="del-err" role="alert">{deleteError}</p>
    {/if}
  {/if}
  {#snippet footer()}
    <button
      type="button"
      class="del-cancel"
      onclick={closeDelete}
      disabled={deleting}
    >
      Cancel
    </button>
    <button
      type="button"
      class="del-confirm"
      onclick={confirmDelete}
      disabled={deleting}
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  {/snippet}
</Modal>

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

  /* A wrapper so we can stack a delete affordance over the card link
     without nesting a <button> inside an <a>. The wrapper itself has
     no visual chrome — the card link still owns the card box. */
  .lib-card-wrap {
    position: relative;
    display: flex;
  }
  .lib-card-wrap > .lib-card {
    flex: 1;
  }
  .lib-card-del {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 2;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 1px solid var(--card-edge, var(--color-border));
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-size: 1.2rem;
    line-height: 1;
    display: grid;
    place-items: center;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 150ms ease,
      background-color 150ms ease,
      color 150ms ease;
  }
  .lib-card-wrap:hover .lib-card-del,
  .lib-card-del:focus-visible {
    opacity: 1;
  }
  .lib-card-del:hover,
  .lib-card-del:focus-visible {
    background: var(--err, #b94545);
    color: #fff;
    border-color: var(--err, #b94545);
  }
  .lib-card-del:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 2px;
  }
  /* Touch / coarse-pointer devices have no hover state — keep the
     delete affordance always visible so phone users can reach it. */
  @media (hover: none) {
    .lib-card-del {
      opacity: 1;
    }
  }

  .del-body {
    margin: 0;
    color: var(--ink, var(--color-fg));
    line-height: 1.4;
  }
  .del-err {
    margin: 0.6rem 0 0;
    color: var(--err, #b94545);
    font-size: 0.85rem;
  }
  .del-cancel,
  .del-confirm {
    min-height: 38px;
    padding: 0 0.85rem;
    border-radius: 6px;
    font: inherit;
    cursor: pointer;
  }
  .del-cancel {
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    color: var(--ink, var(--color-fg));
  }
  .del-confirm {
    background: var(--err, #b94545);
    color: #fff;
    border: 0;
  }
  .del-cancel:disabled,
  .del-confirm:disabled {
    opacity: 0.55;
    cursor: not-allowed;
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
