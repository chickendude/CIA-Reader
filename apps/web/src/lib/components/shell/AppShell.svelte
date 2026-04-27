<script lang="ts">
  import { page } from '$app/stores';
  import { TABS, getActiveTabId, visibleTabs, type Tab } from './tabs.js';
  import type { Snippet } from 'svelte';

  interface Props {
    user: { id: string; displayName: string | null; email: string } | null;
    children: Snippet;
  }

  let { user, children }: Props = $props();

  const tabs = $derived<Tab[]>(visibleTabs(TABS, user !== null));
  const activeId = $derived(getActiveTabId($page.url.pathname, tabs));
</script>

<div class="shell">
  <header class="top-bar" aria-label="Primary">
    <a class="brand" href="/" aria-label="CIA Reader home">
      <span class="brand-mark">CIA</span>
      <span class="brand-name">Reader</span>
    </a>
    <nav class="top-nav" aria-label="Primary navigation">
      {#each tabs as tab (tab.id)}
        <a
          href={tab.href}
          class="tab"
          class:active={activeId === tab.id}
          aria-current={activeId === tab.id ? 'page' : undefined}
        >
          {tab.label}
        </a>
      {/each}
    </nav>
    {#if user}
      <span class="who" aria-label="Signed-in user">
        {user.displayName ?? user.email}
      </span>
      <form method="post" action="/logout" class="logout-form">
        <button type="submit" class="logout">Sign out</button>
      </form>
    {/if}
  </header>

  <main class="content">
    {@render children()}
  </main>

  <nav class="bottom-nav" aria-label="Primary navigation">
    {#each tabs as tab (tab.id)}
      <a
        href={tab.href}
        class="tab"
        class:active={activeId === tab.id}
        aria-current={activeId === tab.id ? 'page' : undefined}
      >
        {tab.label}
      </a>
    {/each}
  </nav>
</div>

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .top-bar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-1);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    text-decoration: none;
    color: inherit;
    font-weight: 700;
  }
  .brand-mark {
    color: var(--color-accent);
    letter-spacing: 0.04em;
  }
  .brand-name {
    color: var(--color-fg);
  }
  .top-nav {
    display: flex;
    gap: var(--space-2);
    flex: 1;
    margin-left: var(--space-4);
  }
  .who {
    color: var(--color-fg-muted);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
  .logout-form {
    margin: 0;
  }
  .logout {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-fg-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-xs);
    padding: var(--space-1) var(--space-2);
  }
  .logout:hover {
    color: var(--color-fg);
  }
  .tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    min-height: var(--touch-target);
    color: var(--color-fg-muted);
    text-decoration: none;
    font-size: var(--font-size-sm);
  }
  .tab:hover {
    color: var(--color-fg);
    background: var(--color-surface-2);
  }
  .tab.active {
    color: var(--color-accent);
    background: var(--color-surface-2);
    font-weight: 600;
  }
  .content {
    flex: 1;
    display: block;
    padding-bottom: calc(var(--touch-target) + var(--space-6));
  }
  .bottom-nav {
    display: none;
  }

  /* Mobile: hide the top nav links (brand + who stay), show the bottom tab bar. */
  @media (max-width: 640px) {
    .top-nav {
      display: none;
    }
    .bottom-nav {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--color-surface-1);
      border-top: 1px solid var(--color-border);
      padding: var(--space-1) var(--space-2);
      padding-bottom: calc(var(--space-1) + env(safe-area-inset-bottom, 0px));
      z-index: 10;
    }
    .bottom-nav .tab {
      padding: var(--space-2);
      font-size: var(--font-size-xs);
    }
    .content {
      padding-bottom: calc(var(--touch-target) * 1.5 + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
