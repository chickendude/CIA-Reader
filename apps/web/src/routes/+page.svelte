<!--
  Home (T-5.12, language-set on click in #436).

  Replaces the M0 diagnostic dashboard with the CIAR design's
  language-pick landing: hero copy + a card grid where each card
  shows a supported language's native + Roman name, script, and the
  signed-in user's known-word count for that language. Clicking a
  card makes that language current (adding it to the user's list if
  needed) and opens the library — the site is split by language.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    switchCurrentLanguage,
    addLanguage,
  } from '$lib/components/shell/language-switch.js';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // null = idle; otherwise the code mid-switch (disables the grid so a
  // double-tap can't fire two requests).
  let choosing = $state<string | null>(null);

  async function choose(code: string, e: MouseEvent) {
    // Honor modifier-clicks (open in new tab) and let no-JS fall back to
    // the href — only hijack a plain left click.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    if (choosing) return;
    choosing = code;
    try {
      // Signed-in: add-or-switch (idempotent). Anonymous: cookie only.
      if (data.user) await addLanguage(code);
      else await switchCurrentLanguage(code);
    } catch {
      // Swallow — fall through to the navigation so the user isn't stuck
      // on the grid; the library just opens on the unchanged language.
    } finally {
      choosing = null;
    }
    // invalidateAll re-runs the root layout load so it re-reads the cookie we
    // just set — otherwise the shared layout (and the library's parent()
    // currentLanguage) would keep the stale pick across this navigation.
    await goto('/library', { invalidateAll: true });
  }
</script>

<svelte:head>
  <title>Parhiba</title>
</svelte:head>

<section class="content">
  <h1 class="page-title">Pick your language</h1>

  <div class="lang-grid">
    {#each data.languages as L (L.code)}
      <a
        class="lang-card card"
        href="/library"
        aria-label={`Read in ${L.displayName}`}
        data-busy={choosing === L.code ? '1' : '0'}
        aria-busy={choosing === L.code}
        onclick={(e) => choose(L.code, e)}
      >
        <div class="lc-native">{L.nativeName}</div>
        <div class="lc-en">{L.displayName}</div>
        <div class="lc-meta">{L.script}</div>
        {#if data.user}
          <div class="lc-stats">
            <div class="lc-stat">
              <div class="n">{L.known.toLocaleString()}</div>
              <div class="l">Known</div>
            </div>
          </div>
        {/if}
      </a>
    {/each}
  </div>

  {#if !data.user}
    <p class="home-cta">
      <a href="/login">Sign in</a> to track known words across each language.
    </p>
  {/if}
  <footer class="home-sources">
    <h2>Where the data comes from</h2>
    <p>
      The Hindi dictionary includes entries from <a href="https://en.wiktionary.org/wiki/Category:Hindi_language">Wiktionary</a>.
      All dictionary data on Parhiba is released under the same
      <a href="https://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International license</a>.
    </p>
  </footer>
</section>

<style>
  .home-sources {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule, var(--color-border));
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.8rem;
    line-height: 1.6;
  }
  .home-sources h2 { font-size: 0.9rem; font-weight: 500; }
  .home-sources a { color: inherit; }
  .lang-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.85rem;
  }
  .card {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 14px;
    box-shadow: var(--shadow-1, 0 1px 2px rgba(0, 0, 0, 0.04));
  }
  .lang-card {
    padding: 1.25rem 1.25rem 1.1rem;
    cursor: pointer;
    transition:
      border-color 150ms ease,
      transform 150ms ease;
    text-decoration: none;
    color: inherit;
    display: block;
  }
  .lang-card:hover {
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 50%,
      var(--card-edge, var(--color-border))
    );
    transform: translateY(-1px);
  }
  .lang-card[data-busy='1'] {
    opacity: 0.6;
    pointer-events: none;
  }
  .lc-native {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.85rem;
    line-height: 1.1;
    color: var(--ink, var(--color-fg));
    margin-bottom: 0.35rem;
  }
  .lc-en {
    font-family: var(--font-serif, var(--font-ui));
    font-size: 0.85rem;
    color: var(--ink-2, var(--color-fg));
  }
  .lc-meta {
    font-size: 0.66rem;
    color: var(--ink-4, var(--color-fg-subtle));
    letter-spacing: 0.04em;
    margin-top: 0.15rem;
    text-transform: uppercase;
  }
  .lc-stats {
    margin-top: 1rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
    font-feature-settings: 'tnum';
  }
  .lc-stat .n {
    font-family: var(--font-serif, var(--font-ui));
    font-size: 1.05rem;
    color: var(--ink, var(--color-fg));
  }
  .lc-stat .l {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .home-cta {
    margin-top: 1.75rem;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.9rem;
  }
  .home-cta a {
    color: var(--accent-ink, var(--color-accent));
  }
</style>
