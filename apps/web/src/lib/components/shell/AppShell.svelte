<script lang="ts">
  import PageLayout from './PageLayout.svelte';
  import { mobileMenuButtonKey } from './mobile-navigation';
  import { page } from '$app/state';
  import { afterNavigate, invalidateAll } from '$app/navigation';
  import { MediaQuery } from 'svelte/reactivity';
  import {
    TABS,
    getActiveTabId,
    groupTabsBySection,
    visibleTabs,
    type Tab,
    type TabIcon,
    type ViewerRole,
  } from './tabs.js';
  import { switchCurrentLanguage } from './language-switch.js';
  import { setContext, type Snippet } from 'svelte';

  interface LanguageOption {
    code: string;
    displayName: string;
    nativeName: string;
    glyph: string;
  }

  interface Props {
    user: {
      id: string;
      displayName: string | null;
      email: string;
      /** drives the curator/admin-gated nav entries (Moderation). */
      role: ViewerRole;
    } | null;
    /** Active language for the current visit. Drives the rail indicator
     *  + per-screen filters. Null when the user has no
     *  language data yet (anonymous fresh visitor). */
    currentLanguage?: string | null;
    /** Language choices available to this viewer. */
    availableLanguages?: LanguageOption[];
    /** Languages available through the Add a language page. */
    addableLanguages?: LanguageOption[];
    children: Snippet;
  }

  let {
    user,
    currentLanguage = null,
    availableLanguages = [],
    addableLanguages = [],
    children,
  }: Props = $props();

  const currentOption = $derived<LanguageOption | null>(
    availableLanguages.find((l) => l.code === currentLanguage) ?? null,
  );

  const desktop = new MediaQuery('(min-width: 960px)', true);
  setContext<Snippet>(mobileMenuButtonKey, menuButton);
  let drawer = $state<globalThis.HTMLDialogElement>();
  let languageTrigger = $state<HTMLButtonElement>();
  let langPickerOpen = $state(false);
  let switching = $state(false);
  let switchError = $state<string | null>(null);

  afterNavigate(() => {
    drawer?.close();
    langPickerOpen = false;
  });

  function closeLanguagePicker() {
    langPickerOpen = false;
    languageTrigger?.focus();
  }

  $effect(() => {
    if (!langPickerOpen) return;
    function onPointer(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('.lang-dropdown')) return;
      if (t.closest('.lang-trigger')) return;
      langPickerOpen = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLanguagePicker();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  // Switch to a language the user already reads. Adding a *new* language
  // happens on the dedicated /languages/new page, not here.
  async function pickLanguage(code: string) {
    if (switching) return;
    if (code === currentLanguage) {
      closeLanguagePicker();
      drawer?.close();
      return;
    }
    switching = true;
    switchError = null;
    try {
      await switchCurrentLanguage(code);
      if (langPickerOpen) closeLanguagePicker();
      drawer?.close();
      // Refresh language-scoped pages and the rail indicator.
      await invalidateAll();
    } catch (e) {
      switchError = (e as Error).message;
    } finally {
      switching = false;
    }
  }

  const tabs = $derived<Tab[]>(
    visibleTabs(TABS, {
      authenticated: user !== null,
      role: user?.role ?? null,
    }),
  );
  const activeId = $derived(getActiveTabId(page.url.pathname, tabs));

  const onReader = $derived(page.url.pathname.startsWith('/reader/'));
  const groups = $derived(groupTabsBySection(tabs));

  // Inline-SVG glyphs match the CIAR design's atom set
  // (see design-handoff/ciar/project/atoms.jsx). One viewBox + a list
  // of paths keeps the markup small without pulling in an icon font.
  const ICONS: Record<TabIcon, string[]> = {
    about: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5', 'M12 8h.01'],
    library: ['M4 5h4v14H4z', 'M10 5h4v14h-4z', 'M16 6l3.5 1-2.5 13L13.5 19'],
    upload: ['M12 4v12', 'M7 9l5-5 5 5', 'M4 18v2h16v-2'],
    words: ['M5 5h14v14H5z', 'M5 9h14', 'M9 5v14'],
    profile: [
      'M12 12a4 4 0 100-8 4 4 0 000 8z',
      'M4 20a8 8 0 0116 0',
    ],
    signin: ['M11 8V5a2 2 0 012-2h6a2 2 0 012 2v14a2 2 0 01-2 2h-6a2 2 0 01-2-2v-3', 'M3 12h12', 'M9 8l-4 4 4 4'],
    // shield outline for the curator/admin moderation tab.
    moderation: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z'],
  };
</script>

<div class="shell" class:reader-route={onReader}>
  {#if !onReader}
    {#if desktop.current}
      <aside class="rail">{@render navigation()}</aside>
    {:else}
      <dialog bind:this={drawer} class="drawer" aria-label="Navigation" onclose={() => (langPickerOpen = false)}>
        <div class="drawer-panel">
          <button type="button" class="menu-button close-menu" aria-label="Close navigation" onclick={() => drawer?.close()}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
          {@render navigation()}
        </div>
        <button type="button" class="backdrop" tabindex="-1" aria-label="Dismiss navigation" onclick={() => drawer?.close()}></button>
      </dialog>
    {/if}
  {/if}

  {#if onReader}
    <main class="content">{@render children()}</main>
  {:else}
    <div class="content">
      {#if page.error}
        <PageLayout>{@render children()}</PageLayout>
      {:else}
        {@render children()}
      {/if}
    </div>
  {/if}
</div>

{#snippet menuButton()}
  <button
    type="button"
    class="menu-button"
    aria-label="Open navigation"
    aria-haspopup="dialog"
    disabled={!drawer}
    onclick={() => drawer?.showModal()}
  >
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  </button>
{/snippet}

{#snippet navigation()}
  <div class="lang-wrap">
    {#if currentOption}
      <button
        type="button"
        class="brand brand-trigger lang-trigger"
        bind:this={languageTrigger}
        aria-haspopup="menu"
        aria-expanded={langPickerOpen}
        aria-label="Switch language (currently {currentOption.displayName})"
        title="Switch language"
        onclick={() => (langPickerOpen = !langPickerOpen)}
      >
        <span class="brand-mark" aria-hidden="true">{currentOption.glyph}</span>
        <span class="brand-text">
          <span class="brand-name">Parhiba</span>
          <span class="brand-sub">{currentOption.displayName}</span>
        </span>
        <svg class="language-chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    {:else}
      <a class="brand" href={user ? '/languages/new' : '/library'} aria-label={user ? 'Add a language' : 'Parhiba Library'}>
        <span class="brand-mark" aria-hidden="true">अ</span>
        <span class="brand-text">
          <span class="brand-name">Parhiba</span>
          <span class="brand-sub">{user ? 'Add a language' : 'Indo-Aryan Reader'}</span>
        </span>
      </a>
    {/if}
    {#if langPickerOpen && currentOption}
      {@render langDropdown()}
    {/if}
  </div>

  <nav class="nav" aria-label="Primary navigation">
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

  {#if user}
    <footer class="rail-foot">
      <span class="who">{user.displayName ?? user.email}</span>
      <form method="post" action="/logout" class="logout-form">
        <button type="submit" class="logout">Sign out</button>
      </form>
    </footer>
  {/if}
{/snippet}

{#snippet langDropdown()}
  <div class="lang-dropdown" role="menu" aria-label="Languages">
    {#if availableLanguages.length === 0}
      <p class="lang-empty">
        You haven't added any languages yet. <a href="/profile">Open settings</a>
        to pick one.
      </p>
    {:else}
      <ul class="lang-list">
        {#each availableLanguages as opt (opt.code)}
          <li>
            <button
              type="button"
              class="lang-row"
              role="menuitemradio"
              aria-checked={opt.code === currentLanguage}
              data-active={opt.code === currentLanguage ? '1' : '0'}
              disabled={switching}
              onclick={() => pickLanguage(opt.code)}
            >
              <span class="lang-row-glyph" aria-hidden="true">{opt.glyph}</span>
              <span class="lang-row-text">
                <span class="lang-row-native">{opt.nativeName}</span>
                <span class="lang-row-en">{opt.displayName}</span>
              </span>
              {#if opt.code === currentLanguage}
                <span class="lang-row-current" aria-label="Current">●</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if switchError}
      <p class="lang-err" role="alert">Could not switch: {switchError}</p>
    {/if}

    {#if addableLanguages.length > 0}
      <div class="lang-foot">
        <!-- Adding a language is its own page. -->
        <a class="lang-add-btn" href="/languages/new">Add a language</a>
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .shell {
    min-height: 100dvh;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 1fr;
    background: var(--paper);
    color: var(--ink);
  }
  .menu-button {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: var(--touch-target);
    height: var(--touch-target);
    background: transparent;
    color: var(--ink);
    border: 0;
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .menu-button:hover {
    background: var(--paper-2);
  }
  .menu-button svg, .language-chevron {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .rail, .drawer-panel {
    flex-direction: column;
    gap: 1.4rem;
    background: var(--paper);
    border-right: 1px solid var(--rule);
  }
  .rail {
    display: none;
  }
  .drawer {
    inset: 0;
    margin: 0;
    width: 100%;
    max-width: none;
    height: 100dvh;
    max-height: none;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
  }
  .drawer[open] {
    display: flex;
  }
  .drawer::backdrop {
    background: var(--color-overlay);
  }
  :global(html:has(.drawer[open])) {
    overflow: hidden;
  }
  .drawer-panel {
    display: flex;
    position: relative;
    width: min(20rem, 88%);
    padding: max(0.75rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .close-menu {
    position: absolute;
    top: max(0.75rem, env(safe-area-inset-top));
    right: 0.5rem;
    z-index: 1;
  }
  .drawer-panel .lang-wrap {
    padding-right: var(--touch-target);
  }
  .backdrop {
    flex: 1;
    border: 0;
    background: transparent;
  }
  @media (min-width: 960px) {
    .shell:not(.reader-route) {
      grid-template-columns: 232px minmax(0, 1fr);
    }
    .rail {
      position: sticky;
      top: 0;
      display: flex;
      height: 100dvh;
      overflow-y: auto;
      padding: 1.4rem 1rem 1rem;
    }
  }
  .who {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--ink-2);
    font-size: 0.85rem;
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
    color: var(--ink-2);
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
    color: var(--ink-2);
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
    background: var(--ink);
    color: var(--paper);
    font-weight: 600;
  }
  .nav-icon {
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
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
    gap: 0.5rem;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.72rem;
    color: var(--ink-2);
  }
  .logout-form {
    flex-shrink: 0;
    margin: 0;
  }
  .logout {
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    color: var(--ink-2);
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
  }
  .logout:hover {
    color: var(--ink, var(--color-fg));
  }

  .content {
    display: block;
    min-width: 0;
  }
  .brand-trigger {
    background: transparent;
    border: 0;
    padding: 0 0.25rem;
    margin: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 8px;
    transition: background 150ms ease;
  }
  .brand-trigger:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 5%, transparent);
  }
  .brand-trigger[aria-expanded='true'] {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 8%, transparent);
  }
  .brand-trigger:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 2px;
  }

  .lang-wrap {
    position: relative;
  }
  .lang-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 50;
    width: 100%;
    max-height: min(70dvh, 480px);
    overflow-y: auto;
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    padding: 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .lang-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .lang-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 9px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
      border-color 150ms ease,
      background 150ms ease;
  }
  .lang-row:hover:not(:disabled) {
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 50%,
      var(--card-edge, var(--color-border))
    );
  }
  .lang-row[data-active='1'] {
    border-color: var(--accent, var(--color-accent));
    background: var(--accent-soft, var(--color-accent));
  }
  .lang-row:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .lang-row-glyph {
    width: 32px;
    height: 32px;
    border-radius: 7px;
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
    display: grid;
    place-items: center;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.1rem;
    flex-shrink: 0;
  }
  .lang-row-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1;
    min-width: 0;
  }
  .lang-row-native {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1rem;
    color: var(--ink, var(--color-fg));
  }
  .lang-row-en {
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.7rem;
    color: var(--ink-2);
  }
  .lang-row-current {
    font-size: 0.85rem;
  }
  .lang-empty {
    color: var(--ink-2);
    font-size: 0.85rem;
    margin: 0;
  }
  .lang-empty a {
    color: inherit;
  }
  .lang-err {
    color: var(--rose, var(--color-danger));
    font-size: 0.78rem;
    margin: 0;
  }

  /* Footer action
   * A single "Add a language" button under the active list, separated
   * by a rule. It navigates to the dedicated add page rather than
   * adding inline. */
  .lang-foot {
    border-top: 1px solid var(--rule, var(--color-border));
    padding-top: 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  /* "Add a language": filled so it reads as the call-to-action.
   * Ink-on-paper clears WCAG AA in every theme. */
  .lang-add-btn {
    text-align: center;
    color: var(--paper, var(--color-bg));
    background: var(--ink, var(--color-fg));
    border: 1px solid var(--ink, var(--color-fg));
    border-radius: 8px;
    text-decoration: none;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.8rem;
    font-weight: 500;
    padding: 0.5rem 0.6rem;
  }
  .lang-add-btn:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 88%, transparent);
  }

  @media (max-width: 959.98px) {
    .nav-item, .brand, .logout {
      min-height: var(--touch-target);
    }
    .logout {
      font-size: var(--font-size-sm);
    }
    .lang-dropdown {
      position: static;
      margin-top: 0.5rem;
      width: calc(100% + var(--touch-target));
    }
  }
  .shell.reader-route:has(:global(.reader[data-mode='page'])) {
    min-height: 100svh;
  }
</style>
