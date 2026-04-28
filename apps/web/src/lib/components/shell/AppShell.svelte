<!--
  App shell (T-1.4 → T-5.11).

  Desktop (>=960px): left rail with brand mark, sectioned nav, version
  stamp + sign-out at the foot. Mobile (<960px): a thin top strip with
  the brand + sign-out, plus a full-width bottom tab bar with icons +
  labels. Each screen owns its own top bar — there is no global
  full-width header on desktop, matching the CIAR design.
-->
<script lang="ts">
  import { page } from '$app/stores';
  import {
    TABS,
    getActiveTabId,
    groupTabsBySection,
    visibleTabs,
    type Tab,
    type TabIcon,
  } from './tabs.js';
  import type { Snippet } from 'svelte';

  interface Props {
    user: { id: string; displayName: string | null; email: string } | null;
    children: Snippet;
  }

  let { user, children }: Props = $props();

  const tabs = $derived<Tab[]>(visibleTabs(TABS, user !== null));
  const activeId = $derived(getActiveTabId($page.url.pathname, tabs));
  const groups = $derived(groupTabsBySection(tabs));

  // Inline-SVG glyphs match the CIAR design's atom set
  // (see design-handoff/ciar/project/atoms.jsx). One viewBox + a list
  // of paths keeps the markup small without pulling in an icon font.
  const ICONS: Record<TabIcon, string[]> = {
    home: ['M3 11.5L12 4l9 7.5', 'M5 10v9h14v-9'],
    library: ['M4 5h4v14H4z', 'M10 5h4v14h-4z', 'M16 6l3.5 1-2.5 13L13.5 19'],
    upload: ['M12 4v12', 'M7 9l5-5 5 5', 'M4 18v2h16v-2'],
    words: ['M5 5h14v14H5z', 'M5 9h14', 'M9 5v14'],
    profile: [
      'M12 12a4 4 0 100-8 4 4 0 000 8z',
      'M4 20a8 8 0 0116 0',
    ],
    signin: ['M11 8V5a2 2 0 012-2h6a2 2 0 012 2v14a2 2 0 01-2 2h-6a2 2 0 01-2-2v-3', 'M3 12h12', 'M9 8l-4 4 4 4'],
  };
</script>

<div class="shell">
  <aside class="rail" aria-label="Primary navigation">
    <a class="brand" href="/" aria-label="CIA Reader home">
      <span class="brand-mark" aria-hidden="true">अ</span>
      <span class="brand-text">
        <span class="brand-name">CIAR</span>
        <span class="brand-sub">Indo-Aryan Reader</span>
      </span>
    </a>

    <nav class="nav" aria-label="Sections">
      {#each groups as group (group.section ?? '_')}
        {#if group.section}
          <div class="nav-section">{group.section}</div>
        {/if}
        {#each group.tabs as tab (tab.id)}
          <a
            href={tab.href}
            class="nav-item"
            class:active={activeId === tab.id}
            aria-current={activeId === tab.id ? 'page' : undefined}
          >
            {#if tab.icon}
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  {#each ICONS[tab.icon] as d (d)}
                    <path {d} />
                  {/each}
                </svg>
              </span>
            {/if}
            <span>{tab.label}</span>
          </a>
        {/each}
      {/each}
    </nav>

    <footer class="rail-foot">
      <span class="version">v0.5 · alpha</span>
      {#if user}
        <form method="post" action="/logout" class="logout-form">
          <button type="submit" class="logout">Sign out</button>
        </form>
      {/if}
    </footer>
  </aside>

  <header class="top-strip" aria-label="Account">
    <a class="brand-strip" href="/" aria-label="CIA Reader home">
      <span class="brand-mark" aria-hidden="true">अ</span>
    </a>
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
        class="bottom-tab"
        class:active={activeId === tab.id}
        aria-current={activeId === tab.id ? 'page' : undefined}
      >
        {#if tab.icon}
          <span class="nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              {#each ICONS[tab.icon] as d (d)}
                <path {d} />
              {/each}
            </svg>
          </span>
        {/if}
        <span>{tab.label}</span>
      </a>
    {/each}
  </nav>
</div>

<style>
  /* Desktop: rail + content. Mobile: top-strip + content + bottom-nav.
     The shell uses the design's paper / ink / rule tokens with a
     fallback to the legacy --color-* family so anything not yet
     redesigned still looks coherent. */
  .shell {
    min-height: 100dvh;
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      'top'
      'content'
      'bottom';
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
  }
  @media (min-width: 960px) {
    .shell {
      grid-template-columns: 232px 1fr;
      grid-template-rows: 1fr;
      grid-template-areas: 'rail content';
    }
  }

  /* —— Top strip (mobile only) —— */
  .top-strip {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--rule, var(--color-border));
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 88%,
      var(--paper-2, transparent)
    );
  }
  @media (min-width: 960px) {
    .top-strip {
      display: none;
    }
  }
  .brand-strip .brand-mark {
    width: 30px;
    height: 30px;
  }
  .who {
    flex: 1;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* —— Rail (desktop only) —— */
  .rail {
    grid-area: rail;
    display: none;
    flex-direction: column;
    gap: 1.4rem;
    padding: 1.4rem 1rem 1rem;
    border-right: 1px solid var(--rule, var(--color-border));
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 88%,
      var(--paper-2, transparent)
    );
    position: sticky;
    top: 0;
    height: 100dvh;
  }
  @media (min-width: 960px) {
    .rail {
      display: flex;
    }
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0 0.25rem;
    text-decoration: none;
    color: inherit;
  }
  .brand-mark {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
    display: grid;
    place-items: center;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.1rem;
    line-height: 1;
    padding-top: 2px;
    flex-shrink: 0;
  }
  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    line-height: 1;
  }
  .brand-name {
    font-family: var(--font-serif, var(--font-ui));
    font-weight: 600;
    font-size: 0.97rem;
    letter-spacing: 0.01em;
  }
  .brand-sub {
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.66rem;
    color: var(--ink-3, var(--color-fg-muted));
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .nav-section {
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-4, var(--color-fg-subtle));
    padding: 0.85rem 0.5rem 0.35rem;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.6rem;
    border-radius: 7px;
    color: var(--ink-2, var(--color-fg-muted));
    text-decoration: none;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.84rem;
  }
  .nav-item:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 5%, transparent);
    color: var(--ink, var(--color-fg));
  }
  .nav-item.active {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 8%, transparent);
    color: var(--ink, var(--color-fg));
    font-weight: 500;
  }
  .nav-icon {
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    color: var(--ink-3, var(--color-fg-muted));
    flex-shrink: 0;
  }
  .nav-item.active .nav-icon {
    color: var(--accent-ink, var(--color-accent));
  }
  .nav-icon svg {
    stroke: currentColor;
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .rail-foot {
    margin-top: auto;
    padding: 0.7rem 0.5rem 0.25rem;
    border-top: 1px solid var(--rule, var(--color-border));
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.72rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .version {
    font-feature-settings: 'tnum';
  }
  .logout-form {
    margin: 0;
  }
  .logout {
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    color: var(--ink-3, var(--color-fg-muted));
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
  }
  .logout:hover {
    color: var(--ink, var(--color-fg));
  }

  /* —— Main content —— */
  .content {
    grid-area: content;
    display: block;
    min-width: 0;
  }
  /* On mobile, leave room for the bottom nav so sticky reader-foot bars
     and trailing content aren't hidden under it. */
  @media (max-width: 959.98px) {
    .content {
      padding-bottom: calc(
        var(--touch-target) * 1.4 + env(safe-area-inset-bottom, 0px)
      );
    }
  }

  /* —— Bottom tab bar (mobile only) —— */
  .bottom-nav {
    grid-area: bottom;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 92%,
      var(--paper-2, transparent)
    );
    border-top: 1px solid var(--rule, var(--color-border));
    padding: 0.25rem 0.4rem;
    padding-bottom: calc(0.25rem + env(safe-area-inset-bottom, 0px));
    z-index: 10;
  }
  @media (min-width: 960px) {
    .bottom-nav {
      display: none;
    }
  }
  .bottom-tab {
    display: grid;
    grid-template-rows: auto auto;
    align-items: center;
    justify-items: center;
    gap: 0.15rem;
    padding: 0.35rem 0.2rem;
    color: var(--ink-3, var(--color-fg-muted));
    text-decoration: none;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.65rem;
    border-radius: 8px;
  }
  .bottom-tab.active {
    color: var(--accent-ink, var(--color-accent));
  }
  .bottom-tab .nav-icon {
    color: inherit;
    width: 18px;
    height: 18px;
  }
</style>
