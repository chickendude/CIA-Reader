<script lang="ts">
  import Pagination from '$lib/components/input/Pagination.svelte';
  import Button from '$lib/components/input/Button.svelte';
  import SubpageHeading from '$lib/components/shell/SubpageHeading.svelte';
  import '$lib/styles/entry-table.css';
  import { invalidateAll } from '$app/navigation';
  import { coverForId } from '$lib/components/library/cover.js';
  import BookActions from '$lib/components/library/BookActions.svelte';
  import Modal from '$lib/components/overlay/Modal.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Shared confirm-delete modal for both text cards and
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
        deleteError = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
        return;
      }
      pendingDelete = null;
      await invalidateAll();
    } finally {
      deleting = false;
    }
  }

  const activePage = $derived(data.tab === 'collections' ? data.collectionsPage : data.page);

  function pageHref(offset: number): string {
    const path = data.allBooks ? '/library/all' : '/library';
    const params = new URLSearchParams();
    if (!data.allBooks) params.set('tab', data.tab);
    if (data.query) params.set('q', data.query);
    if (offset > 0) params.set('offset', String(offset));
    if (activePage.limit !== (data.allBooks ? 10 : 20))
      params.set('limit', String(activePage.limit));
    return params.size ? `${path}?${params}` : path;
  }

  const TABS = [
    { id: 'your', label: 'Yours', requiresAuth: true },
    { id: 'shared', label: 'Shared', requiresAuth: true },
    { id: 'collections', label: 'Collections', requiresAuth: false },
    { id: 'official', label: 'Official', requiresAuth: false },
  ] as const;
</script>

<svelte:head>
  <title>{data.allBooks ? 'All books' : 'Library'} | Parhiba</title>
</svelte:head>

<section class="content">
  {#if data.allBooks}
    <SubpageHeading title="All books" href="/library" closeLabel="Close all books and return to Library" />
  {:else}
    <header class="topbar">
      <h1 class="page-title">Library</h1>
      <nav class="status-tabs" aria-label="Library tabs">
        {#each TABS as t (t.id)}
          {#if !t.requiresAuth || data.isAuthenticated}
            <a
              class="status-tab"
              aria-current={data.tab === t.id ? 'page' : undefined}
              href={`/library?tab=${t.id}`}>{t.label}</a
            >
          {/if}
        {/each}
      </nav>
    </header>
  {/if}

  {#snippet cardTitle(title: string, coverage: number | null)}
    <div class="title-row">
      <span class="title-dev">{title}</span>
      {#if coverage !== null}
        <span class="chip chip-pct" title="Vocabulary coverage">{coverage}% known</span>
      {/if}
    </div>
  {/snippet}

  {#snippet personalActions(card: PageData['page']['cards'][number])}
    <BookActions
      id={card.id}
      title={card.title}
      collection={card.chapterCount != null}
      catalogAction={data.user?.role !== 'admin'
        ? undefined
        : card.visibility === 'official'
          ? 'remove'
          : data.tab === 'your' && card.chapterCount == null && card.status === 'ready'
            ? 'publish'
            : undefined}
      onDelete={data.tab === 'your'
        ? () =>
            card.chapterCount != null
              ? askDeleteCollection(card.id, card.title)
              : askDeleteText(card.id, card.title)
        : undefined}
    />
  {/snippet}

  {#if data.allBooks}
    {#if data.page.cards.length}
      <div class="entry-table-wrap book-table">
        <table class="entry-table" aria-label="Books">
          <thead><tr><th>Title</th><th>Coverage</th><th>Actions</th></tr></thead>
          <tbody>
            {#each data.page.cards as card (card.id)}
              {@const pct = data.textComprehension[card.id]}
              <tr class="linked-row">
                <td>
                  <a class="row-link" href={card.chapterCount != null ? `/collections/${card.id}` : `/reader/${card.id}`}>
                    {card.title}
                  </a>
                </td>
                <td>{pct == null ? '' : `${pct}% known`}</td>
                <td class="action-cell">{@render personalActions(card)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else}
    {#if data.tab === 'your'}
      <div class="recent-heading">
        <h2>Recent books</h2>
        <Button href="/library/all">View all books</Button>
      </div>
    {/if}
    <div class="lib-grid">
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
          <div class="lib-card-wrap">
            <a class="card lib-card" href={`/collections/${col.id}`}>
              <div class={`lib-cover cover-${coverForId(col.id)}`}>
                <div class="cover-title">{col.title}</div>
                <div class="cover-chips">
                  <span class="chip">{col.kind}</span>
                  {#if col.visibility !== 'private'}
                    <span class="chip">{col.visibility}</span>
                  {/if}
                </div>
              </div>
              <div class="body">
                <div class="kind-row">
                  <span class="kind-tag">collection</span>
                  <span class="kind-meta"
                    >{col.textCount} {col.textCount === 1 ? 'text' : 'texts'}</span
                  >
                </div>
                {@render cardTitle(col.title, col.estimatedComprehensionPct)}
              </div>
            </a>
            {#if data.user?.role === 'admin' && col.visibility === 'official'}
              <BookActions id={col.id} title={col.title} collection catalogAction="remove" />
            {/if}
          </div>
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
                </div>
              </div>
              <div class="body">
                <div class="kind-row">
                  <span class="kind-tag">book</span>
                  <span class="kind-meta"
                    >{col.textCount} {col.textCount === 1 ? 'chapter' : 'chapters'}</span
                  >
                </div>
                {@render cardTitle(col.title, col.estimatedComprehensionPct)}
              </div>
            </a>
            {#if data.user?.role === 'admin' && col.visibility === 'official'}
              <BookActions id={col.id} title={col.title} collection catalogAction="remove" />
            {/if}
          </div>
        {/each}
        {#each data.page.cards as card (card.id)}
          {@const pct = data.textComprehension?.[card.id] ?? null}
          <div class="lib-card-wrap">
            <a
              class="card lib-card"
              href={card.chapterCount != null
                ? `/collections/${card.id}`
                : data.tab === 'official'
                  ? `/library/${card.id}`
                  : `/reader/${card.id}`}
            >
              <div class={`lib-cover cover-${coverForId(card.id)}`}>
                <div class="cover-title">{card.title}</div>
                <div class="cover-chips">
                  {#if card.chapterCount != null}<span class="chip">chapter book</span>
                  {:else if card.status !== 'ready'}<span class="chip status-{card.status}">{card.status}</span>{/if}
                  {#if card.visibility !== 'private'}
                    <span class="chip">{card.visibility}</span>
                  {/if}
                </div>
              </div>
              <div class="body">
                {#if card.chapterCount != null}
                  <div class="kind-row">
                    <span class="kind-meta">{card.chapterCount} {card.chapterCount === 1 ? 'chapter' : 'chapters'}</span>
                  </div>
                {/if}
                {@render cardTitle(card.title, pct)}
              </div>
            </a>
            {@render personalActions(card)}
          </div>
        {/each}
      {/if}
      {#if data.tab === 'your' && data.isAuthenticated}
        <a class="card upload-card" href="/upload">
          <div class="upload-card-body">
            <div class="big" aria-hidden="true">+</div>
            <div class="label">Add a text or EPUB</div>
            <div class="sub">.txt, .epub, .html, paste from clipboard</div>
          </div>
        </a>
      {/if}
    </div>
  {/if}

  {#if data.tab !== 'collections' && data.page.cards.length === 0 && data.chapterBookCards.length === 0}
    <p class="empty">
      {#if data.allBooks}
        {data.query ? 'No books match this search.' : 'No books yet.'}
      {:else if data.tab === 'your'}
        No books yet.
      {:else if data.tab === 'shared'}
        No shared texts yet.
      {:else}
        No official texts yet.
      {/if}
    </p>
  {/if}

  {#if data.allBooks || data.tab !== 'your'}
    <Pagination offset={activePage.offset} limit={activePage.limit} total={activePage.totalCount} hrefFor={pageHref} />
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
        This removes the text, its chapters, tokens, audio, and progress.
      {/if}
      It can't be undone.
    </p>
    {#if deleteError}
      <p class="del-err" role="alert">{deleteError}</p>
    {/if}
  {/if}
  {#snippet footer()}
    <button type="button" class="del-cancel" onclick={closeDelete} disabled={deleting}>
      Cancel
    </button>
    <button type="button" class="del-confirm" onclick={confirmDelete} disabled={deleting}>
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  {/snippet}
</Modal>

<style>
  .recent-heading {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 1rem;
    justify-content: space-between;
  }
  .recent-heading h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .book-table {
    overflow: visible;
  }
  .action-cell {
    position: relative;
    height: 3.3rem;
    box-sizing: border-box;
  }
  .action-cell :global(.book-actions) {
    z-index: 2;
  }
  .linked-row:has(:global(.book-actions.open)) {
    z-index: 3;
  }
  .book-table th:last-child {
    width: 1%;
    white-space: nowrap;
    border-start-end-radius: 14px;
  }
  .book-table th:first-child {
    border-start-start-radius: 14px;
  }

  :global(html):has(.status-tabs) {
    scrollbar-gutter: stable;
  }
  .topbar {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1rem;
  }
  @media (min-width: 640px) {
    .topbar {
      grid-template-columns: 1fr auto;
    }
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
  .status-tab[aria-current='page'] {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 8%, transparent);
    color: var(--ink, var(--color-fg));
  }

  .lib-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
  }

  .lib-card-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .lib-card-wrap > .lib-card {
    flex: 1;
  }
  .lib-card-wrap:has(:global(.book-actions)) .cover-chips {
    right: 3.3rem;
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
    background: color-mix(in oklch, var(--paper, var(--color-bg)) 80%, transparent);
  }
  .chip-pct {
    background: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 22%,
      var(--paper, var(--color-bg))
    );
    white-space: nowrap;
    font-feature-settings: 'tnum';
    color: var(--ink-2, var(--color-fg));
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
  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.25rem 0.5rem;
  }
  .title-dev {
    overflow-wrap: anywhere;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    line-height: 1.3;
    color: var(--ink, var(--color-fg));
  }

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

</style>
