<script lang="ts">
  type Option = { value: string; label: string; href: string; detail?: string };

  let { label, value, options }: { label: string; value: string; options: Option[] } = $props();
  const selected = $derived(options.find(option => option.value === value));
  let menu: globalThis.HTMLDetailsElement;
  let trigger: HTMLElement;
  let open = $state(false);

  function close() {
    menu.open = false;
    trigger.focus();
  }

  function navigateMenu(event: KeyboardEvent) {
    if (!menu?.contains(event.target as Node)) return;
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const links = Array.from(menu.querySelectorAll<HTMLAnchorElement>('nav a'));
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    const first = event.key === 'Home' || (current < 0 && event.key === 'ArrowDown');
    const last = event.key === 'End' || (current < 0 && event.key === 'ArrowUp');
    const step = event.key === 'ArrowUp' ? -1 : 1;
    const index = first ? 0 : last ? links.length - 1 : (current + step + links.length) % links.length;
    menu.open = true;
    links[index]?.focus();
  }

  function dismissOutside(event: Event) {
    if (open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  }
</script>

<svelte:window onkeydown={navigateMenu} onpointerdown={dismissOutside} onfocusin={dismissOutside} />

<details bind:this={menu} bind:open>
  <summary bind:this={trigger} aria-label={`${label}: ${selected?.label ?? ''} ${selected?.detail ?? ''}`.trim()}>
    <span class="choice">{selected?.label}</span>
    {#if selected?.detail}<span class="number">{selected.detail}</span>{/if}
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
      <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
  </summary>
  <nav aria-label={label} data-sveltekit-preload-data="off" data-sveltekit-keepfocus data-sveltekit-noscroll>
    {#each options as option (option.value)}
      <a href={option.href} aria-current={option.value === value ? 'true' : undefined}
        onclick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) close(); }}>
        <span>{option.label}</span>
        {#if option.detail}<span class="number">{option.detail}</span>{/if}
      </a>
    {/each}
  </nav>
</details>

<style>
  details { position: relative; min-width: 0; width: 100%; color: var(--ink); }
  summary, a {
    display: flex; align-items: center; gap: .65rem; box-sizing: border-box;
    font-size: .86rem; padding: .45rem .65rem; cursor: pointer;
  }
  summary {
    min-height: 2.25rem; list-style: none; border: 1px solid var(--rule); border-radius: 6px;
    background: var(--card); font-weight: 550;
  }
  summary::-webkit-details-marker { display: none; }
  .choice { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .number { margin-inline-start: auto; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  svg { color: var(--ink-3); flex: none; }
  details[open] svg { transform: rotate(180deg); }
  nav {
    position: absolute; z-index: 5; inset-inline-start: 0; top: calc(100% + .25rem);
    box-sizing: border-box; inline-size: var(--filter-menu-width, 100%); min-inline-size: 100%;
    max-inline-size: min(32rem, 100cqi); overflow-wrap: anywhere;
    padding: .5rem 0; border-radius: 8px; border: 1px solid var(--rule);
    background: var(--card); box-shadow: var(--shadow-2, 0 6px 20px #0002);
    max-height: 50vh; overflow-y: auto;
  }
  a { min-height: 2.15rem; padding-inline: .9rem; color: var(--ink); text-decoration: none; }
  a[aria-current] { background: var(--accent-soft); font-weight: 600; }
  a:hover, a:focus-visible {
    background: color-mix(in srgb, var(--accent) 23%, var(--card));
    box-shadow: inset 3px 0 var(--accent);
  }
  summary:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
