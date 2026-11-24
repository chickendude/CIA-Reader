<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/input/Button.svelte';
  import { getToastStore } from '$lib/components/toast/toast-store.js';

  type Bookmark = { textId: string; chapterIdx: number; tokenIdx: number };
  let { storageKey, position, mode, showRomanization }: {
    storageKey: string;
    position: Bookmark;
    mode: string;
    showRomanization: boolean;
  } = $props();

  const { pushToast } = getToastStore();
  let saved = $state<Bookmark | null>(null);
  let ready = $state(false);
  let open = $state(false);
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;
  const label = $derived(saved ? 'Reading bookmark' : 'Bookmark this position');
  const href = $derived.by(() => {
    if (!saved) return null;
    const query = new URLSearchParams({
      mode, chapter: String(saved.chapterIdx), token: String(saved.tokenIdx),
      roman: showRomanization ? '1' : '0',
    });
    return `/reader/${encodeURIComponent(saved.textId)}?${query}`;
  });

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      saved = value && typeof value.textId === 'string'
        && Number.isSafeInteger(value.chapterIdx) && value.chapterIdx >= 0
        && Number.isSafeInteger(value.tokenIdx) && value.tokenIdx >= 0 ? value : null;
    } catch {
      saved = null;
    }
    if (!saved) open = false;
  }

  onMount(() => {
    read();
    ready = true;
    function sync(event: globalThis.StorageEvent) {
      if (event.key === null || event.key === storageKey) read();
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  });

  function close() {
    open = false;
    trigger.focus();
  }

  function update(next: Bookmark | null) {
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
    } catch {
      pushToast({ kind: 'error', message: 'Could not update the bookmark in this browser.' });
      return;
    }
    saved = next;
    close();
    pushToast({ kind: 'success', message: next ? 'Reading position bookmarked.' : 'Bookmark removed.' });
  }

  function activate() {
    if (saved) open = !open;
    else update(position);
  }

  function dismissOutside(event: Event) {
    if (open && event.target instanceof Node && !container.contains(event.target)) open = false;
  }

  function handleKey(event: KeyboardEvent) {
    if (!open || !(event.target instanceof Node) || !container.contains(event.target)) return;
    if (event.key === 'Escape') close();
    if (['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.stopPropagation();
  }
</script>

<svelte:window onpointerdown={dismissOutside} onfocusin={dismissOutside} />
<svelte:document onkeydown={handleKey} />

<div class="bookmark" bind:this={container} role="group" aria-label="Reading position">
  <button type="button" class="trigger" bind:this={trigger} aria-label={label} title={label}
    aria-expanded={saved ? open : undefined} disabled={!ready}
    onclick={activate}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"
      fill={saved ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
      <path d="M6 3.5h12v17l-6-4-6 4z" />
    </svg>
  </button>
  {#if open && href}
    <div class="choices">
      <!-- A fresh reader mount also restores a bookmark within the currently open chapter. -->
      <Button {href} data-sveltekit-reload variant="primary">Return to bookmark</Button>
      <Button onclick={() => update(position)}>Move bookmark here</Button>
      <Button onclick={() => update(null)}>Remove bookmark</Button>
    </div>
  {/if}
</div>

<style>
  .bookmark { position: relative; }
  .trigger {
    display: grid; place-items: center; width: 32px; height: 32px;
    border: 0; border-radius: 8px; background: transparent; color: var(--ink-2); cursor: pointer;
  }
  .trigger:hover { background: var(--paper-2); }
  .trigger:focus-visible { outline: 2px solid var(--accent); }
  .choices {
    position: absolute; right: 0; top: calc(100% + .25rem); display: grid; gap: .35rem;
    width: max-content; padding: .5rem; border: 1px solid var(--rule); border-radius: 8px;
    background: var(--paper); box-shadow: var(--shadow-2, 0 6px 20px #0002);
  }
  @media (max-width: 639px) {
    .trigger { width: 44px; height: 44px; }
  }
</style>
