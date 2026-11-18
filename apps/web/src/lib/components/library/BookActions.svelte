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
  <div class="book-actions" bind:this={container}>
    <button type="button" class="trigger" bind:this={trigger} aria-label={`Actions for ${title}`}
      aria-expanded={open} disabled={busy} onclick={() => open = !open}>
      <span aria-hidden="true">•••</span>
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
  .book-actions { position: absolute; top: .4rem; right: .4rem; z-index: 1; }
  .book-actions:focus-within { z-index: 3; }
  button { font: inherit; color: var(--ink); cursor: pointer; }
  .trigger { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 1px solid var(--card-edge); border-radius: 50%; background: var(--card); }
  .trigger span { font-size: .8rem; letter-spacing: .06em; }
  .choices { position: absolute; top: calc(100% + .2rem); right: 0; width: max-content; padding: .25rem; border: 1px solid var(--card-edge); border-radius: .5rem; background: var(--card); box-shadow: var(--shadow-2, 0 4px 14px #0003); }
  .choices button { display: block; width: 100%; padding: .6rem .8rem; text-align: left; background: transparent; border: 0; border-radius: .3rem; font-size: .85rem; }
  .choices button:hover, .choices button:focus-visible { background: var(--paper-2); }
  .danger { color: var(--err, #b94545); }
</style>
