<!--
  Curator phrase list (T-14.4a). Parallel to
  /moderation/dictionary for lemmas. Read-only here — the detail
  page handles editing.
-->
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function hrefFor(filter: Partial<{ source: string | null; hidden: boolean | null; locked: boolean | null }>): string {
    if (!data.language) return '/moderation/phrases';
    const params = new URLSearchParams();
    params.set('language', data.language.code);
    const source = filter.source !== undefined ? filter.source : data.filters.source;
    if (source) params.set('source', source);
    const hidden = filter.hidden !== undefined ? filter.hidden : data.filters.hidden;
    if (hidden !== null && hidden !== undefined) params.set('hidden', String(hidden));
    const locked = filter.locked !== undefined ? filter.locked : data.filters.locked;
    if (locked !== null && locked !== undefined) params.set('locked', String(locked));
    params.set('limit', String(data.limit));
    return `/moderation/phrases?${params.toString()}`;
  }
</script>

<svelte:head>
  <title>Phrase dictionary — moderation</title>
</svelte:head>

<div class="ph">
  <header class="ph-h">
    <h1>Phrases</h1>
    <p class="muted">
      Curator-side editor for multi-word entries (M14). Pick a language to browse;
      click a row to edit its gloss, lock state, or moderation flag.
    </p>
  </header>

  {#if !data.language}
    <p class="muted">You don't have curator rights on any language yet.</p>
  {:else}
    <nav class="ph-langs" aria-label="Language picker">
      {#each data.descriptors as d (d.code)}
        <a
          class="ph-lang"
          class:active={d.code === data.language.code}
          href={`/moderation/phrases?language=${d.code}`}
        >
          {d.displayName}
          <span class="muted">{d.nativeName}</span>
        </a>
      {/each}
    </nav>

    <div class="ph-filters" role="toolbar" aria-label="Filters">
      <a class="chip" class:active={data.filters.source === null} href={hrefFor({ source: null })}>
        All sources
      </a>
      <a class="chip" class:active={data.filters.source === 'curator'} href={hrefFor({ source: 'curator' })}>
        Curator
      </a>
      <a class="chip" class:active={data.filters.source === 'user'} href={hrefFor({ source: 'user' })}>
        User
      </a>
      <a class="chip" class:active={data.filters.source === 'official_dictionary'} href={hrefFor({ source: 'official_dictionary' })}>
        Official
      </a>
      <span class="ph-sep" aria-hidden="true">·</span>
      <a class="chip" class:active={data.filters.locked === true} href={hrefFor({ locked: true })}>
        Locked only
      </a>
      <a class="chip" class:active={data.filters.hidden === true} href={hrefFor({ hidden: true })}>
        Hidden only
      </a>
    </div>

    {#if data.phrases.length === 0}
      <p class="muted">No phrases match the current filter.</p>
    {:else}
      <table class="ph-table" data-testid="phrase-list">
        <thead>
          <tr>
            <th>Surface</th>
            <th>Gloss</th>
            <th class="num">Translations</th>
            <th class="num">Chapters</th>
            <th>Source</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {#each data.phrases as p (p.id)}
            <tr>
              <td><a class="link" href={`/moderation/phrases/${p.id}`}>{p.surfaceNormalised}</a></td>
              <td class="muted">{p.glossDefault ?? '—'}</td>
              <td class="num">{p.translationCount}</td>
              <td class="num">{p.chapterCount}</td>
              <td class="muted small">{p.source}</td>
              <td class="muted small">
                {#if p.curatorLocked}<span class="flag" data-flag="locked">locked</span>{/if}
                {#if p.hidden}<span class="flag" data-flag="hidden">hidden</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

<style>
  .ph {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    color: var(--ink, var(--color-fg));
  }
  .ph-h h1 {
    margin: 0 0 0.25rem;
    font-family: var(--font-serif);
    font-size: 1.5rem;
  }
  .muted {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
  }
  .ph-langs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 1rem 0;
  }
  .ph-lang {
    padding: 0.35rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--rule, var(--color-border));
    text-decoration: none;
    color: inherit;
  }
  .ph-lang.active {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  }
  .ph-filters {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin: 0.75rem 0 1rem;
    align-items: center;
  }
  .ph-sep {
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0 0.2rem;
  }
  .chip {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid var(--rule, var(--color-border));
    text-decoration: none;
    color: inherit;
    font-size: 0.8rem;
  }
  .chip.active {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  }
  .ph-table {
    width: 100%;
    border-collapse: collapse;
  }
  .ph-table th,
  .ph-table td {
    padding: 0.5rem 0.4rem;
    border-bottom: 1px solid var(--rule, var(--color-border));
    text-align: left;
  }
  .ph-table th {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .num {
    text-align: right;
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
  }
  .small {
    font-size: 0.78rem;
  }
  .link {
    color: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
  }
  .flag {
    display: inline-block;
    margin-right: 0.3rem;
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    border: 1px solid var(--rule, var(--color-border));
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .flag[data-flag='locked'] {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .flag[data-flag='hidden'] {
    background: color-mix(in srgb, oklch(60% 0.18 25) 12%, transparent);
  }
</style>
