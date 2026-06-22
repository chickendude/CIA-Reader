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
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import {
    TABS,
    getActiveTabId,
    groupTabsBySection,
    visibleTabs,
    type Tab,
    type TabIcon,
    type ViewerRole,
  } from './tabs.js';
  import {
    isImmersiveAttributeSet,
    readPersistedImmersive,
    setImmersiveAttribute,
    writePersistedImmersive,
  } from '../reader/immersive.js';
  import { switchCurrentLanguage } from './language-switch.js';
  import type { Snippet } from 'svelte';

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
      /** T-3.14: drives the curator/admin-gated nav entries (Moderation). */
      role: ViewerRole;
    } | null;
    /** Active language for the current visit. Drives the rail indicator
     *  + per-screen filters (T-5.25). Null when the user has no
     *  language data yet (anonymous fresh visitor). */
    currentLanguage?: string | null;
    /** Languages the signed-in user has a `user_languages` row for —
     *  the picker's options. Empty for anonymous visitors. */
    availableLanguages?: LanguageOption[];
    /** Supported languages the user hasn't added yet — the switcher's
     *  "Add a language" options (#436). Empty for anonymous visitors. */
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

  // T-5.25: language picker. Click the top-left brand icon → custom
  // dropdown anchored beneath it, listing every active language.
  // Selecting one PUTs the cookie + reloads layout data so every
  // loader picks up the new pick.
  let langPickerOpen = $state(false);
  let switching = $state(false);
  let switchError = $state<string | null>(null);

  // Close on outside-click / Escape while the dropdown is open. Two
  // dropdowns can be in the DOM at once (rail + mobile top-strip), so
  // we match by class rather than a single bind:this.
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
      if (e.key === 'Escape') langPickerOpen = false;
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  // Switch to a language the user already reads. Adding a *new* language
  // happens on the dedicated /languages/new page (#436), not here.
  async function pickLanguage(code: string) {
    if (switching) return;
    if (code === currentLanguage) {
      langPickerOpen = false;
      return;
    }
    switching = true;
    switchError = null;
    try {
      await switchCurrentLanguage(code);
      langPickerOpen = false;
      // Re-run every loader so the new currentLanguage is picked up (rail
      // indicator, home grid, library / words / upload scoping…).
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
  const activeId = $derived(getActiveTabId($page.url.pathname, tabs));

  // The reader is immersive: it renders full-bleed over the shell and owns
  // its own exit (the × button / Esc). Hide the rail-toggle chevron there so
  // no nav chrome pokes through on top of the text.
  const onReader = $derived($page.url.pathname.startsWith('/reader/'));
  const groups = $derived(groupTabsBySection(tabs));

  // T-5.26: hamburger toggle for the rail / shell chrome. Reuses the
  // same `data-reader-immersive` attribute + `cia_reader_immersive`
  // sessionStorage key from T-5.16 so the existing CSS keeps working
  // — only the button location and icon change. Bootstrap on mount
  // so a refresh keeps the user's preference.
  let collapsed = $state(false);
  onMount(() => {
    collapsed = readPersistedImmersive();
    setImmersiveAttribute(collapsed);
    // Reflect any external attribute mutation (e.g. the reader page's
    // Esc handler clearing immersive on exit) back into our local
    // state so the button glyph stays in sync.
    const obs = new MutationObserver(() => {
      const next = isImmersiveAttributeSet();
      if (next !== collapsed) collapsed = next;
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-reader-immersive'],
    });
    return () => obs.disconnect();
  });
  function toggleCollapsed() {
    collapsed = !collapsed;
    setImmersiveAttribute(collapsed);
    writePersistedImmersive(collapsed);
  }

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
    // T-3.14: shield outline for the curator/admin moderation tab.
    moderation: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z'],
  };
</script>

<!-- T-5.26: chevron toggles the rail / shell chrome. Positioned fixed
     so it stays clickable in both states — sits flush against the
     rail's inner-right edge when expanded (chevron points left, "tuck
     it in"), and snaps to the viewport's left edge when collapsed
     (chevron points right, "pull it out"). -->
{#if !onReader}
  <button
    type="button"
    class="rail-toggle"
    data-collapsed={collapsed ? '1' : '0'}
    aria-label={collapsed ? 'Show navigation' : 'Hide navigation'}
    aria-pressed={collapsed}
    title={collapsed ? 'Show navigation' : 'Hide navigation'}
    onclick={toggleCollapsed}
  >
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {#if collapsed}
        <path d="M9 6l6 6-6 6" />
      {:else}
        <path d="M15 6l-6 6 6 6" />
      {/if}
    </svg>
  </button>
{/if}

<div class="shell" class:reader-route={onReader}>
  <aside class="rail" aria-label="Primary navigation">
    <div class="lang-wrap">
      {#if currentOption}
        <button
          type="button"
          class="brand brand-trigger lang-trigger"
          aria-haspopup="menu"
          aria-expanded={langPickerOpen}
          aria-label="Switch language (currently {currentOption.displayName})"
          title="Switch language"
          onclick={() => (langPickerOpen = !langPickerOpen)}
        >
          <span class="brand-mark" aria-hidden="true">{currentOption.glyph}</span>
          <span class="brand-text">
            <span class="brand-name">CIAR</span>
            <span class="brand-sub">Indo-Aryan Reader</span>
          </span>
        </button>
      {:else}
        <a class="brand" href="/" aria-label="CIA Reader home">
          <span class="brand-mark" aria-hidden="true">अ</span>
          <span class="brand-text">
            <span class="brand-name">CIAR</span>
            <span class="brand-sub">Indo-Aryan Reader</span>
          </span>
        </a>
      {/if}
      {#if langPickerOpen && currentOption}
        {@render langDropdown()}
      {/if}
    </div>

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
    <div class="lang-wrap-compact">
      {#if currentOption}
        <button
          type="button"
          class="brand-strip brand-trigger lang-trigger"
          aria-haspopup="menu"
          aria-expanded={langPickerOpen}
          aria-label="Switch language (currently {currentOption.displayName})"
          title="Switch language"
          onclick={() => (langPickerOpen = !langPickerOpen)}
        >
          <span class="brand-mark" aria-hidden="true">{currentOption.glyph}</span>
        </button>
      {:else}
        <a class="brand-strip" href="/" aria-label="CIA Reader home">
          <span class="brand-mark" aria-hidden="true">अ</span>
        </a>
      {/if}
      {#if langPickerOpen && currentOption}
        {@render langDropdown()}
      {/if}
    </div>
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

<!-- T-5.25 / #436: language switcher. Anchored under the top-left brand
     icon. Lists the languages you read (switch in place); adding a new
     language is its own page, reached via the "Add a language" button at
     the foot. Fine-grained per-language settings live on /profile. -->
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
        <!-- Adding a language is its own page (#436). -->
        <a class="lang-add-btn" href="/languages/new">Add a language</a>
      </div>
    {/if}
  </div>
{/snippet}

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

  /* —— Chevron / rail-toggle button (T-5.26) ————————————————
   * Mobile-only now. The rail is static on desktop, so there's
   * nothing to expand/collapse there; on mobile we keep the toggle as
   * an immersive-mode affordance (hides top-strip + bottom-nav for
   * full-screen reading). Vertical tab on the viewport's left edge. */
  .rail-toggle {
    position: fixed;
    top: 1rem;
    left: 0;
    width: 22px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 0 8px 8px 0;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-left: 0;
    color: var(--ink-3, var(--color-fg-muted));
    cursor: pointer;
    z-index: 30;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.08);
    transition:
      background 150ms ease,
      color 150ms ease;
  }
  @media (min-width: 960px) {
    .rail-toggle {
      display: none;
    }
  }
  .rail-toggle:hover {
    background: var(--accent-soft, var(--color-accent));
    color: var(--accent-ink, var(--color-accent-fg, #fff));
  }

  /* —— Language picker dropdown (T-5.25) ————————————————————————
   * Anchored to the top-left brand icon (rail on desktop, top-strip
   * on mobile). The brand-mark glyph reflects the current language so
   * the trigger doubles as a status indicator. */
  .brand-trigger {
    background: transparent;
    border: 0;
    padding: 0 0.25rem;
    margin: 0;
    font: inherit;
    color: inherit;
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
  .lang-wrap-compact {
    position: relative;
    flex-shrink: 0;
  }

  .lang-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 50;
    min-width: 240px;
    max-width: min(90vw, 320px);
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
    color: var(--ink-3, var(--color-fg-muted));
  }
  .lang-row-current {
    color: var(--accent-ink, var(--color-accent));
    font-size: 0.85rem;
  }
  .lang-empty {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    margin: 0;
  }
  .lang-empty a {
    color: var(--accent-ink, var(--color-accent));
  }
  .lang-err {
    color: var(--rose, var(--color-danger));
    font-size: 0.78rem;
    margin: 0;
  }

  /* —— Footer action (#436) —————————————————————————————————————
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

  /* —— Immersive mode (mobile-only) ————————————————————————————
   * `data-reader-immersive="1"` on <html> hides the mobile chrome
   * (top-strip + bottom-nav) so the screen content occupies the
   * whole viewport. Desktop's rail stays static regardless. */
  :global(html[data-reader-immersive='1']) .top-strip,
  :global(html[data-reader-immersive='1']) .bottom-nav {
    display: none;
  }
  :global(html[data-reader-immersive='1']) .content {
    /* Bottom nav is gone — drop the safe-area padding too. */
    padding-bottom: 0;
  }

  /* —— Reader route: immersive on every breakpoint ————————————————
   * The reader owns the whole window — its × button / Esc are the way out, so
   * the shell's nav chrome is hidden and the content reclaims the full width.
   * (The rail-toggle chevron lives outside .shell and is hidden in markup.) */
  .shell.reader-route .top-strip,
  .shell.reader-route .bottom-nav {
    display: none;
  }
  @media (min-width: 960px) {
    .shell.reader-route {
      grid-template-columns: 1fr;
      grid-template-areas: 'content';
    }
    .shell.reader-route .rail {
      display: none;
    }
  }
</style>
