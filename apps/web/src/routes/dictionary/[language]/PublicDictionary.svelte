<script lang="ts">
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import { numberedMeanings } from '$lib/dictionary/meanings';
  import Pagination from '$lib/components/input/Pagination.svelte';
  import { dictionaryProfile } from '$lib/dictionary/profiles';
  import { patternLabel } from '$lib/dictionary/hindi-patterns';
  import type { PageProps } from './$types';

  type PublicData = Extract<PageProps['data'], { staff: null }>;
  let { data }: { data: PublicData } = $props();
  const entry = $derived(data.entry);
  const language = $derived(data.language.code);
  const partsOfSpeech = $derived(dictionaryProfile(language).partsOfSpeech);
  let query = $state(untrack(() => data.query.q));
  let timer: ReturnType<typeof setTimeout>;
  afterNavigate(({ type }) => {
    if (type === 'popstate' || type === 'link') query = data.query.q;
  });
  beforeNavigate(() => clearTimeout(timer));
  onDestroy(() => clearTimeout(timer));

  function resultUrl(id: string | null, offset: number) {
    const url = new URL(page.url);
    if (id) url.searchParams.set('id', id);
    else url.searchParams.delete('id');
    if (offset) url.searchParams.set('offset', String(offset));
    else url.searchParams.delete('offset');
    return url.pathname + url.search;
  }

  function search(q: string) {
    clearTimeout(timer);
    const url = new URL(resultUrl(null, 0), page.url);
    if (q.trim()) url.searchParams.set('q', q.trim());
    else url.searchParams.delete('q');
    void goto(url, { keepFocus: true, noScroll: true, replaceState: true });
  }
</script>

<div class="panes">
  <aside aria-label="Dictionary search">
    <form method="GET" role="search" onsubmit={(event) => {
      event.preventDefault();
      search(String(new FormData(event.currentTarget).get('q') ?? ''));
    }}>
      {#if data.canEdit}<input type="hidden" name="mode" value="public" />{/if}
      {#each data.query.pos as pos}<input type="hidden" name="pos" value={pos} />{/each}
      <input type="hidden" name="limit" value={data.limit} />
      <input type="search" name="q" aria-label="Search words" dir="auto"
        placeholder={'Search ' + data.language.displayName + ' or English'} bind:value={query}
        oninput={(event) => {
          clearTimeout(timer);
          const value = event.currentTarget.value;
          if (!('isComposing' in event && event.isComposing)) timer = setTimeout(() => search(value), 200);
        }} />
    </form>
    {#if data.usedRomanizationTransliteration}
      <small>Showing matches for <bdi lang={language}>{data.effectiveQuery}</bdi>.</small>
    {:else if data.usedNuktaFallback}
      <small>Showing matches with alternate nukta spellings.</small>
    {/if}
    <div class="results">
      {#each data.lemmas as row (row.id)}
        <a href={resultUrl(row.id, data.offset)} class:chosen={entry?.id === row.id}
          aria-current={entry?.id === row.id ? 'true' : undefined} data-sveltekit-noscroll>
          <strong lang={language} dir="auto">{row.headword}</strong> <small>{row.pos.toLowerCase()}</small>
          {#if row.glossDefault}<span>{numberedMeanings(row.glossDefault)}</span>{/if}
        </a>
      {:else}
        <p role="status">No matching entries.</p>
      {/each}
    </div>
    {#if data.totalCount > data.limit || data.offset > 0}
      <Pagination offset={data.offset} limit={data.limit} total={data.totalCount} hrefFor={(n) => resultUrl(null, n)} />
    {/if}
  </aside>
  {#if entry}
    <article aria-labelledby="dictionary-headword">
      <h2 id="dictionary-headword" lang={language} dir="auto">{entry.headword}</h2>
      <p class="part-of-speech">{partsOfSpeech[entry.pos] ?? entry.pos.toLowerCase()}{#if language === 'hi' && entry.paradigm && entry.paradigm !== 'invariant'}, {patternLabel(entry.paradigm)}{/if}</p>
      {#if entry.alternativeHeadwords.length}
        <p lang={language} dir="auto">{entry.alternativeHeadwords.join(', ')}</p>
      {/if}
      {#if entry.meanings.length}
        <ol aria-label="Meanings">
          {#each entry.meanings as meaning}
            <li lang={meaning.targetLanguage} dir="auto">{meaning.text}
              {#if meaning.sourceAttribution}<small class="source">{meaning.sourceAttribution}</small>{/if}
            </li>
          {/each}
        </ol>
      {:else}
        <p>No definition available.</p>
      {/if}
      {#if entry.forms.length}
        {#key entry.id}
          <details>
            <summary>Forms</summary>
            <p lang={language} dir="auto">{entry.forms.join(', ')}</p>
          </details>
        {/key}
      {/if}
    </article>
  {/if}
</div>

<style>
  input[type='search'] {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    color: inherit;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 0.4rem;
    padding: 0.45rem 0.65rem;
  }
  .results a {
    color: inherit;
    text-decoration: none;
    padding: 0.45rem 0.65rem;
    box-sizing: border-box;
  }
  .results a:hover { background: var(--surface-2); }
  .results a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  h2 { margin: 0; font-size: 1.65rem; }
  summary { cursor: pointer; font-weight: 600; }
  article { overflow-wrap: anywhere; }
  .part-of-speech, .source { color: var(--ink-2); }
  .part-of-speech { margin-top: 0.25rem; }
  .source { display: block; }
  ol { padding-inline-start: 1.6em; list-style: decimal; }
  li + li { margin-top: 0.3em; }
</style>
