<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function minutes(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function statsHref(
    patch: Partial<{
      textOffset: number | null;
      collectionOffset: number | null;
    }>,
  ): string {
    const params = new URLSearchParams();
    params.set('textLimit', String(data.textsPage.limit));
    params.set('collectionLimit', String(data.collectionsPage.limit));
    params.set(
      'textOffset',
      String(patch.textOffset ?? data.textsPage.offset),
    );
    params.set(
      'collectionOffset',
      String(patch.collectionOffset ?? data.collectionsPage.offset),
    );
    return `/stats/${data.language}?${params.toString()}`;
  }
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
    <p class="ls-h-sub">Your reading, listening, and vocabulary stats for this language.</p>
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
    <div class="ls-tile">
      <div class="ls-tile-n">{minutes(data.stats.listeningMinutes)}</div>
      <div class="ls-tile-l">Minutes listened</div>
    </div>
  </section>

  <!-- T-14.6: phrase counters parallel to the lemma counters above.
       The pane only renders when the user has at least encountered
       a phrase in this language so an empty M14 corpus doesn't show
       four "0" tiles for every learner. -->
  {#if data.stats.encounteredPhrasesCount > 0 || data.stats.knownPhrasesCount > 0 || data.stats.learningPhrasesCount > 0}
    <section class="ls-totals" data-testid="phrase-stats">
      <h2 class="ls-totals-h">Phrases</h2>
      <div class="ls-tile">
        <div class="ls-tile-n">{data.stats.knownPhrasesCount.toLocaleString()}</div>
        <div class="ls-tile-l">Known phrases</div>
      </div>
      <div class="ls-tile">
        <div class="ls-tile-n">{data.stats.learningPhrasesCount.toLocaleString()}</div>
        <div class="ls-tile-l">Learning</div>
      </div>
      <div class="ls-tile">
        <div class="ls-tile-n">{data.stats.encounteredPhrasesCount.toLocaleString()}</div>
        <div class="ls-tile-l">Phrases seen in your texts</div>
      </div>
      <div class="ls-tile">
        <div class="ls-tile-n">{data.stats.ignoredPhrasesCount.toLocaleString()}</div>
        <div class="ls-tile-l">Ignored phrases</div>
      </div>
    </section>
  {/if}

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
            <th class="num">Listened</th>
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
              <td class="num">{minutes(t.listeningMinutes)} min</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if data.textsPage.prevOffset !== null || data.textsPage.nextOffset !== null}
        <nav class="ls-pager" aria-label="Text stats pages">
          {#if data.textsPage.prevOffset !== null}
            <a class="ls-page-link" href={statsHref({ textOffset: data.textsPage.prevOffset })}>Previous</a>
          {/if}
          {#if data.textsPage.nextOffset !== null}
            <a class="ls-page-link" href={statsHref({ textOffset: data.textsPage.nextOffset })}>Next</a>
          {/if}
        </nav>
      {/if}
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
            <th class="num">Listened</th>
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
              <td class="num">{minutes(c.listeningMinutes)} min</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if data.collectionsPage.prevOffset !== null || data.collectionsPage.nextOffset !== null}
        <nav class="ls-pager" aria-label="Collection stats pages">
          {#if data.collectionsPage.prevOffset !== null}
            <a class="ls-page-link" href={statsHref({ collectionOffset: data.collectionsPage.prevOffset })}>Previous</a>
          {/if}
          {#if data.collectionsPage.nextOffset !== null}
            <a class="ls-page-link" href={statsHref({ collectionOffset: data.collectionsPage.nextOffset })}>Next</a>
          {/if}
        </nav>
      {/if}
    </section>
  {/if}

  <section class="ls-section ls-export">
    <h2>Export</h2>
    <p>
      <a class="ls-link" href={`/api/v1/me/vocabulary/export?language=${data.language}`}>
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
  /* T-14.6: phrase tile pane reuses the lemma totals layout but
     adds a sub-heading so the two groups read as siblings rather
     than one merged row. Spans the full grid width. */
  .ls-totals-h {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
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
  .ls-pager {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.7rem;
  }
  .ls-page-link {
    color: inherit;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    text-decoration: none;
    font-size: 0.82rem;
  }
  .ls-page-link:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 5%, transparent);
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
