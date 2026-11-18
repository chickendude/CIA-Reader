<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { pushToast } from '$lib/components/toast/toast-store.js';

  let { id, title, collection = false, catalogAction, onDelete }: {
    id: string;
    title: string;
    collection?: boolean;
    catalogAction?: 'publish' | 'remove';
    onDelete?: () => void;
  } = $props();

  let open = $state(false);
  let busy = $state(false);
  let container = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();

  function close() {
    open = false;
    trigger?.focus();
  }

  $effect(() => {
    if (!open) return;
    function dismiss(event: Event) {
      if (event.target instanceof Node && !container?.contains(event.target)) open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      document.removeEventListener('keydown', escape);
    };
  });

  async function updateCatalog() {
    if (busy || !catalogAction) return;
    const publishing = catalogAction === 'publish';
    close();
    busy = true;
    try {
      const path = collection ? `/api/v1/collections/${id}` : `/api/v1/texts/${id}/visibility`;
      const response = await fetch(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility: publishing ? 'official' : 'private' }),
      });
      if (!response.ok) throw new Error((await response.json()).message || 'Could not update the Official library.');
      await invalidateAll();
      pushToast({ kind: 'success', message: publishing ? `Published “${title}” to Official.` : `Removed “${title}” from Official.` });
    } catch (error) {
      pushToast({ kind: 'error', message: error instanceof Error ? error.message : 'Could not update the Official library.' });
    } finally {
      busy = false;
    }
  }
</script>

{#if catalogAction || onDelete}
  <div class="book-actions" class:open bind:this={container}>
    <button type="button" class="trigger" bind:this={trigger} aria-label={`Actions for ${title}`}
      aria-expanded={open} disabled={busy} onclick={() => open = !open}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <circle cx="10" cy="4" r="1.7" />
        <circle cx="10" cy="10" r="1.7" />
        <circle cx="10" cy="16" r="1.7" />
      </svg>
    </button>
    {#if open}
      <div class="choices">
        {#if catalogAction}
          <button type="button" onclick={updateCatalog}>{catalogAction === 'publish' ? 'Publish to Official library' : 'Remove from Official library'}</button>
        {/if}
        {#if onDelete}
          <button type="button" class="danger" onclick={() => { close(); onDelete?.(); }}>Delete</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .book-actions {
    position: absolute;
    top: .4rem;
    right: .4rem;
    z-index: 1;
    --menu-bg: var(--paper, var(--color-bg));
  }
  .book-actions.open { z-index: 3; }
  button { font: inherit; color: var(--ink, var(--color-fg)); cursor: pointer; }
  .trigger {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 50%;
    background: var(--menu-bg);
  }
  .choices {
    position: absolute;
    top: calc(100% + .2rem);
    right: 0;
    width: max-content;
    padding: .25rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: .5rem;
    background: var(--menu-bg);
    box-shadow: var(--shadow-2, 0 4px 14px #0003);
  }
  .choices button {
    display: block;
    width: 100%;
    padding: .6rem .8rem;
    text-align: start;
    background: var(--menu-bg);
    border: 0;
    border-radius: .3rem;
    font-size: .85rem;
  }
  .choices button:hover, .choices button:focus-visible {
    background: color-mix(in srgb, var(--ink) 14%, var(--menu-bg));
  }
  .danger { color: var(--err, #b94545); }
</style>
