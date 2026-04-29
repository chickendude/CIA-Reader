<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Stats — {data.languageDescriptor.displayName} — CIA Reader</title>
</svelte:head>

<div class="ls">
  <header class="ls-h">
    <h1>
      {data.languageDescriptor.displayName}
      <span class="ls-native">{data.languageDescriptor.nativeName}</span>
    </h1>
    <p class="ls-h-sub">Your reading + vocabulary stats for this language.</p>
  </header>

  <section class="ls-totals">
    <div class="ls-tile">
      <div class="ls-tile-n">{data.stats.knownCount.toLocaleString()}</div>
      <div class="ls-tile-l">Known lemmas</div>
    </div>
    <div class="ls-tile">
      <div class="ls-tile-n">{data.stats.learningCount.toLocaleString()}</div>
      <div class="ls-tile-l">Learning</div>
    </div>
    <div class="ls-tile">
      <div class="ls-tile-n">{data.stats.encounteredCount.toLocaleString()}</div>
      <div class="ls-tile-l">Lemmas seen in your texts</div>
    </div>
    <div class="ls-tile">
      <div class="ls-tile-n">{data.stats.ignoredCount.toLocaleString()}</div>
      <div class="ls-tile-l">Ignored (proper nouns / borrowings)</div>
    </div>
  </section>

  <section class="ls-section">
    <h2>Per-text comprehension</h2>
    {#if data.texts.length === 0}
      <p class="ls-empty">No texts in {data.languageDescriptor.displayName} yet.</p>
    {:else}
      <table class="ls-table">
        <thead>
          <tr>
            <th>Text</th>
            <th class="num">Unique lemmas</th>
            <th class="num">Words</th>
            <th class="num">Est. comprehension</th>
          </tr>
        </thead>
        <tbody>
          {#each data.texts as t (t.textId)}
            <tr>
              <td>
                <a href={`/reader/${t.textId}`} class="ls-link">{t.title}</a>
              </td>
              <td class="num">{t.uniqueLemmas.toLocaleString()}</td>
              <td class="num">{t.totalWords.toLocaleString()}</td>
              <td class="num">
                <span class="ls-pct" data-level={t.estimatedComprehensionPct >= 80 ? 'high' : t.estimatedComprehensionPct >= 50 ? 'mid' : 'low'}>
                  {t.estimatedComprehensionPct}%
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  {#if data.collections.length > 0}
    <section class="ls-section">
      <h2>Per-collection comprehension</h2>
      <table class="ls-table">
        <thead>
          <tr>
            <th>Collection</th>
            <th class="num">Texts</th>
            <th class="num">Est. comprehension</th>
          </tr>
        </thead>
        <tbody>
          {#each data.collections as c (c.collectionId)}
            <tr>
              <td>
                <a href={`/collections/${c.collectionId}`} class="ls-link">{c.title}</a>
              </td>
              <td class="num">{c.textCount}</td>
              <td class="num">
                <span class="ls-pct" data-level={c.estimatedComprehensionPct >= 80 ? 'high' : c.estimatedComprehensionPct >= 50 ? 'mid' : 'low'}>
                  {c.estimatedComprehensionPct}%
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  <section class="ls-section ls-export">
    <h2>Export</h2>
    <p>
      <a class="ls-link" href={`/api/v1/me/vocabulary.csv?language=${data.language}`}>
        Download vocabulary as CSV
      </a> · headword, POS, gloss, status — Anki-friendly.
    </p>
  </section>
</div>

<style>
  .ls {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    color: var(--ink, var(--color-fg));
  }
  .ls-h h1 {
    margin: 0 0 0.2rem;
    font-family: var(--font-serif, system-ui);
    font-size: 1.6rem;
  }
  .ls-native {
    font-family: var(--font-serif-dev, var(--font-serif));
    color: var(--ink-3, var(--color-fg-muted));
    margin-left: 0.4rem;
    font-weight: 400;
  }
  .ls-h-sub {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    margin: 0 0 1.4rem;
  }
  .ls-totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.75rem;
  }
  .ls-tile {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 10px;
    padding: 0.85rem 1rem;
  }
  .ls-tile-n {
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
    font-size: 1.5rem;
    color: var(--ink, var(--color-fg));
  }
  .ls-tile-l {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 0.2rem;
  }
  .ls-section {
    margin-bottom: 2rem;
  }
  .ls-section h2 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0 0 0.55rem;
  }
  .ls-empty {
    padding: 1rem;
    color: var(--ink-3, var(--color-fg-muted));
    font-style: italic;
  }
  .ls-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    overflow: hidden;
  }
  .ls-table th,
  .ls-table td {
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--rule-2, var(--color-border));
    text-align: left;
    font-size: 0.85rem;
  }
  .ls-table th {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 4%, transparent);
    font-weight: 500;
    font-size: 0.78rem;
  }
  .ls-table th.num,
  .ls-table td.num {
    text-align: right;
    font-feature-settings: 'tnum';
    font-family: var(--font-mono-display, var(--font-mono));
  }
  .ls-link {
    color: inherit;
    text-decoration: none;
  }
  .ls-link:hover {
    text-decoration: underline;
  }
  .ls-pct {
    font-feature-settings: 'tnum';
  }
  .ls-pct[data-level='high'] {
    color: #2a9d4a;
  }
  .ls-pct[data-level='mid'] {
    color: #c5851b;
  }
  .ls-pct[data-level='low'] {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .ls-export {
    color: var(--ink-2, var(--color-fg));
    font-size: 0.9rem;
  }
</style>
