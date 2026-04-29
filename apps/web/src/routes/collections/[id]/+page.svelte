<script lang="ts">
  import { invalidateAll, goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  import { untrack } from 'svelte';
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

  async function removeItem(textId: string) {
    if (!window.confirm('Remove this text from the collection?')) return;
    const res = await fetch(
      `/api/v1/collections/${data.collection.id}/items/${textId}`,
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
    </p>
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

  <ol class="cd-list">
    {#each data.items as item, i (item.text.id)}
      <li
        class="cd-item"
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
      </li>
    {:else}
      <li class="cd-empty">
        No texts in this collection yet.
      </li>
    {/each}
  </ol>

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
  {/if}
</div>

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
</style>
