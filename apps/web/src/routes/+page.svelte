<!--
  Home (T-5.12).

  Replaces the M0 diagnostic dashboard with the CIAR design's
  language-pick landing: hero copy + a card grid where each card
  shows a supported language's native + Roman name, script, and the
  signed-in user's known-word count for that language. Clicking a
  card jumps to the library filtered to that language.
-->
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>CIA Reader — Read in Indo-Aryan languages</title>
</svelte:head>

<section class="content">
  <h1 class="home-hero">
    Read in your <em>own time.</em>
  </h1>
  <p class="home-sub">
    Pick a language to begin. Your progress, known-words list, and per-language
    settings are kept separately for each script.
  </p>

  <div class="lang-grid">
    {#each data.languages as L (L.code)}
      <a
        class="lang-card card"
        href={`/library?language=${L.code}`}
        aria-label={`Open the ${L.displayName} library`}
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
</section>

<style>
  .content {
    max-width: 64rem;
    padding: 2rem 1.25rem 3rem;
    margin: 0 auto;
  }
  @media (min-width: 768px) {
    .content {
      padding: 3rem 2rem 4rem;
    }
  }
  .home-hero {
    font-family: var(--font-serif, var(--font-ui));
    font-size: 2rem;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: var(--ink, var(--color-fg));
    font-weight: 400;
    margin: 0 0 0.5rem;
  }
  @media (min-width: 768px) {
    .home-hero {
      font-size: 2.5rem;
    }
  }
  .home-hero em {
    font-style: italic;
    color: var(--accent-ink, var(--color-accent));
  }
  .home-sub {
    font-size: 0.95rem;
    color: var(--ink-3, var(--color-fg-muted));
    max-width: 36rem;
    margin: 0 0 1.75rem;
    line-height: 1.5;
  }
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
