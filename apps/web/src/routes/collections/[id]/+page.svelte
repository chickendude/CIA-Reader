<script lang="ts">
  import { invalidateAll, goto } from '$app/navigation';
  import Modal from '$lib/components/overlay/Modal.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  import { untrack } from 'svelte';

  // Single shared confirmation modal — used in place of the native
  // `window.confirm()` so the dialog matches the rest of the app's
  // visual language (and so we can support styled bodies, focus
  // trapping, etc.). Each caller fills in title/body/confirmLabel
  // and an async handler.
  let confirmState = $state<{
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  let confirmRunning = $state(false);

  function openConfirm(opts: {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => Promise<void> | void;
  }) {
    confirmState = opts;
  }
  function closeConfirm() {
    if (confirmRunning) return;
    confirmState = null;
  }
  async function runConfirm() {
    if (!confirmState || confirmRunning) return;
    confirmRunning = true;
    try {
      await confirmState.onConfirm();
    } finally {
      confirmRunning = false;
      confirmState = null;
    }
  }
  // Drag-and-drop reorder. The dragged element's index is captured
  // on dragstart; on drop we splice the items array client-side
  // and POST the new order. Mouse only — keyboard reorder is a
  // follow-up.
  let dragIdx = $state<number | null>(null);
  let liveOrder = $state(untrack(() => data.items.map((i) => i.text.id)));
  $effect(() => {
    liveOrder = data.items.map((i) => i.text.id);
  });

  let savingOrder = $state(false);
  let saveError = $state<string | null>(null);

  function onDragStart(idx: number) {
    return (e: DragEvent) => {
      dragIdx = idx;
      e.dataTransfer?.setData('text/plain', String(idx));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    };
  }
  function onDragOver(e: DragEvent) {
    if (dragIdx == null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }
  async function onDrop(target: number) {
    if (dragIdx == null) return;
    const from = dragIdx;
    dragIdx = null;
    if (from === target) return;
    const next = [...liveOrder];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(target, 0, moved);
    liveOrder = next;
    savingOrder = true;
    saveError = null;
    try {
      const res = await fetch(`/api/v1/collections/${data.collection.id}/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ textIds: next }),
      });
      if (!res.ok) {
        saveError = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
      }
      await invalidateAll();
    } finally {
      savingOrder = false;
    }
  }

  // Add-text autocomplete. Owner pastes the text id (or in a
  // future iteration, picks from a list); we POST and refresh.
  let addTextId = $state('');
  let adding = $state(false);
  let addError = $state<string | null>(null);
  async function addText(e: Event) {
    e.preventDefault();
    if (!addTextId.trim()) return;
    adding = true;
    addError = null;
    try {
      const res = await fetch(`/api/v1/collections/${data.collection.id}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ textId: addTextId.trim() }),
      });
      if (!res.ok) {
        addError = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
        return;
      }
      addTextId = '';
      await invalidateAll();
    } finally {
      adding = false;
    }
  }

  function removeItem(textId: string) {
    const item = data.items.find((i) => i.text.id === textId);
    openConfirm({
      title: 'Remove from collection',
      body: item
        ? `Remove “${item.text.title}” from this collection? The text itself isn't deleted.`
        : 'Remove this text from the collection?',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        const res = await fetch(
          `/api/v1/collections/${data.collection.id}/items/${textId}`,
          { method: 'DELETE' },
        );
        if (res.ok) await invalidateAll();
      },
    });
  }

  // Re-dispatch NLP processing for member texts. Two modes:
  //  - stuck rescue: when any chapter is `pending` or `failed`, the
  //    button targets just those (POST without body, server default).
  //  - full re-run: when everything is `ready`, the button targets
  //    every chapter (POST `{all: true}`) — useful after a
  //    dictionary import where the existing tokenizations are stale.
  const stuckCount = $derived(
    data.items.filter(
      (it) => it.text.status === 'pending' || it.text.status === 'failed',
    ).length,
  );
  const reprocessLabel = 'Reprocess All';
  let reprocessing = $state(false);
  let reprocessMessage = $state<string | null>(null);
  function reprocessAll() {
    if (data.items.length === 0) return;
    const all = stuckCount === 0;
    const target = all ? data.items.length : stuckCount;
    openConfirm({
      title: 'Reprocess chapters',
      body: all
        ? `Re-run NLP processing on all ${target} ${target === 1 ? 'chapter' : 'chapters'} in this collection? Existing tokens will be replaced.`
        : `Reprocess ${target} stuck ${target === 1 ? 'chapter' : 'chapters'}? Already-ready chapters won't be touched.`,
      confirmLabel: 'Reprocess',
      onConfirm: async () => {
        reprocessing = true;
        reprocessMessage = null;
        try {
          const res = await fetch(
            `/api/v1/collections/${data.collection.id}/reprocess`,
            {
              method: 'POST',
              headers: all ? { 'content-type': 'application/json' } : {},
              body: all ? JSON.stringify({ all: true }) : undefined,
            },
          );
          if (!res.ok) {
            reprocessMessage =
              (await res.text().catch(() => '')) || `HTTP ${res.status}`;
            return;
          }
          const body = (await res.json()) as { dispatched: number };
          reprocessMessage = `Dispatched ${body.dispatched} ${
            body.dispatched === 1 ? 'chapter' : 'chapters'
          } — refresh in a few seconds to see status updates.`;
          await invalidateAll();
        } finally {
          reprocessing = false;
        }
      },
    });
  }

  // T-8.4 — manage sharing. Owner enters a recipient email; the API
  // looks up the user and inserts a row in `collection_shares`. The
  // grant also flips visibility from 'private' to 'shared' so the
  // canReadText fallback path picks it up.
  let shareEmail = $state('');
  let sharing = $state(false);
  let shareError = $state<string | null>(null);
  async function grantShare(e: Event) {
    e.preventDefault();
    const email = shareEmail.trim();
    if (!email) return;
    sharing = true;
    shareError = null;
    try {
      const res = await fetch(
        `/api/v1/collections/${data.collection.id}/shares`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ recipientEmail: email }),
        },
      );
      if (!res.ok) {
        shareError = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
        return;
      }
      shareEmail = '';
      await invalidateAll();
    } finally {
      sharing = false;
    }
  }

  async function revokeShare(userId: string) {
    if (!window.confirm('Revoke this share?')) return;
    const res = await fetch(
      `/api/v1/collections/${data.collection.id}/shares/${userId}`,
      { method: 'DELETE' },
    );
    if (res.ok) await invalidateAll();
  }
</script>

<svelte:head>
  <title>{data.collection.title} — CIA Reader</title>
</svelte:head>

<div class="cd">
  <header class="cd-h">
    <h1>{data.collection.title}</h1>
    <p class="cd-meta">
      <span class="cd-pill">{data.collection.kind}</span>
      <span class="cd-pill">{data.collection.language}</span>
      <span class="cd-pill">{data.collection.visibility}</span>
      <span class="cd-pill">{data.items.length} {data.items.length === 1 ? 'text' : 'texts'}</span>
      {#if data.isOwner && data.items.length > 0}
        <button
          type="button"
          class="cd-pill-btn"
          onclick={reprocessAll}
          disabled={reprocessing}
        >
          {reprocessing ? 'Dispatching…' : reprocessLabel}
        </button>
      {/if}
    </p>
    {#if data.isOwner && reprocessMessage}
      <p class="cd-muted" role="status">{reprocessMessage}</p>
    {/if}
    {#if data.collection.description}
      <p class="cd-desc">{data.collection.description}</p>
    {/if}

    {#if data.aggregatedPctRead > 0}
      <div class="cd-progress">
        <span class="cd-progress-l">Overall progress</span>
        <div class="cd-bar"><i style="width: {data.aggregatedPctRead}%"></i></div>
        <span class="cd-progress-pct">{data.aggregatedPctRead}%</span>
      </div>
    {/if}
    {#if data.collection.kind === 'course'}
      <p class="cd-completion">
        <strong>{data.completedCount}</strong>
        of {data.items.length} {data.items.length === 1 ? 'text' : 'texts'} completed
        {#if data.completedCount === data.items.length && data.items.length > 0}
          · 🏁 course finished
        {/if}
      </p>
    {/if}
  </header>

  <div class="cd-list" role="list">
    {#each data.items as item, i (item.text.id)}
      {#if item.isSectionAnchor}
        <!-- This spine item is the part-intro page that the publisher's
             TOC nests over the next group of chapters. Render it as
             the section header instead of a duplicate chapter card.
             Link the header to its own reader page so the intro
             content stays reachable. -->
        <a class="cd-section cd-section-link" href={`/reader/${item.text.id}`}>
          {item.text.title}
        </a>
      {:else}
        {#if item.sectionTitle && (i === 0 || data.items[i - 1]?.sectionTitle !== item.sectionTitle) && !(data.items[i - 1]?.isSectionAnchor && data.items[i - 1]?.text.title === item.sectionTitle)}
          <h3 class="cd-section">{item.sectionTitle}</h3>
        {/if}
        <div
          class="cd-item"
          role="listitem"
          draggable={data.isOwner}
          ondragstart={onDragStart(i)}
          ondragover={onDragOver}
          ondrop={() => onDrop(i)}
        >
          <span class="cd-pos">{i + 1}</span>
          <a class="cd-link" href={`/reader/${item.text.id}`}>{item.text.title}</a>
          <span class="cd-status">{item.text.status}</span>
          {#if item.pctRead > 0}
            <span class="cd-pct">{Math.round(item.pctRead)}%</span>
          {/if}
          {#if data.isOwner}
            <button
              type="button"
              class="cd-remove"
              aria-label="Remove from collection"
              onclick={() => removeItem(item.text.id)}
            >×</button>
          {/if}
        </div>
      {/if}
    {:else}
      <p class="cd-empty">
        No texts in this collection yet.
      </p>
    {/each}
  </div>

  {#if savingOrder}
    <p class="cd-muted">Saving new order…</p>
  {/if}
  {#if saveError}
    <p class="cd-err" role="alert">{saveError}</p>
  {/if}

  {#if data.isOwner}
    <section class="cd-add">
      <h2>Add a text</h2>
      <form onsubmit={addText} class="cd-add-form">
        <input
          type="text"
          placeholder="Text ID (uuid)"
          bind:value={addTextId}
        />
        <button type="submit" disabled={adding || !addTextId.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>
      {#if addError}
        <p class="cd-err" role="alert">{addError}</p>
      {/if}
      <p class="cd-muted">
        Tip: open the text in the reader and copy the id from the URL.
        <button
          type="button"
          class="cd-link-btn"
          onclick={() => goto('/library')}
        >Browse library</button>
      </p>
    </section>

    <section class="cd-share" data-testid="manage-shares">
      <h2>Sharing</h2>
      <p class="cd-muted">
        Grant another reader access to this collection by email.
        Sharing also unlocks every member text for that reader.
      </p>
      <form onsubmit={grantShare} class="cd-add-form">
        <input
          type="email"
          placeholder="reader@example.com"
          bind:value={shareEmail}
          autocomplete="off"
          data-testid="share-email-input"
        />
        <button type="submit" disabled={sharing || !shareEmail.trim()}>
          {sharing ? 'Sharing…' : 'Grant access'}
        </button>
      </form>
      {#if shareError}
        <p class="cd-err" role="alert">{shareError}</p>
      {/if}
      {#if data.shares.length === 0}
        <p class="cd-muted">No one else has access yet.</p>
      {:else}
        <ul class="cd-share-list">
          {#each data.shares as s (s.sharedWithUserId)}
            <li>
              <span>
                {s.recipient?.displayName ?? s.recipient?.email ?? s.sharedWithUserId}
                {#if s.recipient?.displayName}
                  <span class="cd-muted">· {s.recipient.email}</span>
                {/if}
              </span>
              <button
                type="button"
                class="cd-remove"
                aria-label="Revoke share"
                onclick={() => revokeShare(s.sharedWithUserId)}
              >Revoke</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<Modal
  open={confirmState !== null}
  onClose={closeConfirm}
  title={confirmState?.title ?? ''}
  width={420}
>
  {#if confirmState}
    <p class="confirm-body">{confirmState.body}</p>
  {/if}
  {#snippet footer()}
    <button
      type="button"
      class="confirm-cancel"
      onclick={closeConfirm}
      disabled={confirmRunning}
    >
      Cancel
    </button>
    <button
      type="button"
      class={confirmState?.danger ? 'confirm-danger' : 'confirm-go'}
      onclick={runConfirm}
      disabled={confirmRunning}
    >
      {confirmRunning ? 'Working…' : (confirmState?.confirmLabel ?? 'Confirm')}
    </button>
  {/snippet}
</Modal>

<style>
  .cd {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    color: var(--ink, var(--color-fg));
  }
  .cd-h h1 {
    margin: 0 0 0.4rem;
    font-family: var(--font-serif, system-ui);
    font-size: 1.6rem;
  }
  .cd-meta {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin: 0 0 0.6rem;
  }
  .cd-pill {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    border-radius: 999px;
    padding: 0.18rem 0.5rem;
    font-size: 0.62rem;
    color: var(--ink-3, var(--color-fg-muted));
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .cd-desc {
    color: var(--ink-2, var(--color-fg));
    margin: 0 0 0.7rem;
  }
  .cd-progress {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.6rem;
    align-items: center;
    margin: 0.6rem 0 1rem;
  }
  .cd-progress-l {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .cd-bar {
    height: 6px;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 8%, transparent);
    border-radius: 3px;
    overflow: hidden;
    position: relative;
  }
  .cd-bar > i {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent, var(--color-accent));
    border-radius: 3px;
  }
  .cd-progress-pct {
    font-feature-settings: 'tnum';
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.85rem;
  }
  .cd-completion {
    margin: 0.4rem 0 1rem;
    font-size: 0.85rem;
    color: var(--ink-2, var(--color-fg));
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 6%, var(--card, var(--color-bg)));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
  }
  .cd-list {
    list-style: none;
    margin: 1rem 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  /* Section heading rendered between groups of chapters that share
     the same `section_title` (e.g. "Part 1: Make It Obvious").
     Slightly heavier weight than the body but smaller than the
     collection title so the hierarchy reads: collection → section
     → chapter. Extra top margin separates each group. */
  .cd-section {
    margin: 0.9rem 0 0;
    font-family: var(--font-serif, var(--font-ui));
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--ink, var(--color-fg));
    letter-spacing: 0.01em;
  }
  /* First section header shouldn't add extra space above (the list's
     own top margin already provides it). */
  .cd-list > .cd-section:first-child {
    margin-top: 0;
  }
  /* Section header that's also a link to the part-intro page. Same
     typography as a plain section header; the underline + color
     reveal that it's clickable. */
  .cd-section-link {
    display: block;
    text-decoration: none;
    color: var(--ink, var(--color-fg));
  }
  .cd-section-link:hover {
    color: var(--accent, var(--color-accent));
  }
  .cd-section-link:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 2px;
    border-radius: 4px;
  }
  .cd-item {
    display: grid;
    grid-template-columns: auto 1fr auto auto auto;
    gap: 0.6rem;
    align-items: center;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: var(--card, var(--color-bg));
    cursor: grab;
  }
  .cd-item[draggable='true']:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 3%, var(--card, var(--color-bg)));
  }
  .cd-pos {
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.8rem;
    width: 1.5rem;
  }
  .cd-link {
    color: inherit;
    text-decoration: none;
    font-family: var(--font-serif-dev, var(--font-serif));
  }
  .cd-link:hover {
    text-decoration: underline;
  }
  .cd-status {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .cd-pct {
    font-feature-settings: 'tnum';
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
    color: var(--accent, var(--color-accent));
  }
  .cd-remove {
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 1.2rem;
    padding: 0 0.3rem;
  }
  .cd-empty {
    list-style: none;
    padding: 1.5rem;
    color: var(--ink-3, var(--color-fg-muted));
    text-align: center;
    font-style: italic;
  }
  .cd-add {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule, var(--color-border));
  }
  .cd-add h2 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0 0 0.6rem;
  }
  .cd-add-form {
    display: flex;
    gap: 0.4rem;
  }
  .cd-add-form input {
    flex: 1;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
  }
  .cd-add-form button {
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg));
    border: 0;
    border-radius: 6px;
    padding: 0.4rem 0.85rem;
    font: inherit;
    cursor: pointer;
  }
  .cd-add-form button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  /* Pill-sized action button that lives alongside .cd-pill chips in
     the meta row. Same height + radius as the pills. Filled accent +
     paired ink for WCAG AA contrast (accent-on-transparent fails on
     this surface). `margin-left: auto` pushes it to the far right of
     the flex row, separating action from metadata. */
  .cd-pill-btn {
    margin-left: auto;
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg));
    border: 1px solid var(--accent, var(--color-accent));
    border-radius: 999px;
    padding: 0.18rem 0.7rem;
    /* Label is slightly larger than the surrounding pills for
       readability; tighter line-height keeps the overall box height
       matched (pills inherit body line-height 1.5 at font-size
       0.62rem ≈ 0.93rem leading; 0.75 * 1.24 ≈ 0.93rem). */
    font-size: 0.75rem;
    line-height: 1.24;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .cd-pill-btn:hover:not(:disabled) {
    /* Darken the accent slightly so the hover state is detectable
       without dropping contrast. */
    background: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 85%,
      var(--ink, var(--color-fg))
    );
  }
  .cd-pill-btn:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 2px;
  }
  .cd-pill-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .confirm-body {
    margin: 0;
    color: var(--ink, var(--color-fg));
    line-height: 1.4;
  }
  .confirm-cancel,
  .confirm-go,
  .confirm-danger {
    min-height: 38px;
    padding: 0 0.85rem;
    border-radius: 6px;
    font: inherit;
    cursor: pointer;
  }
  .confirm-cancel {
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    color: var(--ink, var(--color-fg));
  }
  .confirm-go {
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg));
    border: 0;
  }
  .confirm-danger {
    background: var(--err, #b94545);
    color: #fff;
    border: 0;
  }
  .confirm-cancel:disabled,
  .confirm-go:disabled,
  .confirm-danger:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .cd-err {
    color: var(--err, #b94545);
    font-size: 0.82rem;
    margin: 0.3rem 0 0;
  }
  .cd-muted {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
    margin: 0.4rem 0 0;
  }
  .cd-link-btn {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent, var(--color-accent));
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
  }
  .cd-share {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule, var(--color-border));
  }
  .cd-share h2 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0 0 0.6rem;
  }
  .cd-share-list {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .cd-share-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    font-size: 0.85rem;
  }
  .cd-share-list .cd-remove {
    color: var(--err, #b94545);
    font-size: 0.78rem;
  }
</style>
