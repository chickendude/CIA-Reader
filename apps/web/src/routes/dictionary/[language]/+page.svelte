<script lang="ts">
  import Pagination from '$lib/components/input/Pagination.svelte';
  import '$lib/styles/entry-table.css';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import Button from '$lib/components/input/Button.svelte';
  import { patternLabel } from '$lib/dictionary/hindi-patterns.js';
  import EditableDefinition from '$lib/components/reader/EditableDefinition.svelte';
  import ScriptAwareInput from '$lib/components/input/ScriptAwareInput.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();


  let searchForm: HTMLFormElement;
  let timer: ReturnType<typeof setTimeout>;
  let inputKey = $state(0);
  beforeNavigate(({ type }) => {
    if (type === 'popstate' || type === 'link') clearTimeout(timer);
  });
  afterNavigate(({ type }) => {
    if (type === 'popstate' || type === 'link') inputKey++;
  });
  onDestroy(() => clearTimeout(timer));

  function search() {
    clearTimeout(timer);
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(searchForm)) {
      if (typeof value === 'string' && value.trim()) params.append(name, value.trim());
    }
    void goto(`/dictionary/${data.language.code}?${params}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  function queueSearch() {
    clearTimeout(timer);
    timer = setTimeout(search, 200);
  }

  function hrefWith(offset: number): string {
    const params = new URLSearchParams();
    if (data.query.q) params.set('q', data.query.q);
    for (const p of data.query.pos) params.append('pos', p);
    if (offset > 0) params.set('offset', String(offset));
    if (data.limit !== 50) params.set('limit', String(data.limit));
    const qs = params.toString();
    return qs ? `?${qs}` : `/dictionary/${data.language.code}`;
  }
</script>

<svelte:head>
  <title>{data.language.nativeDictionaryTitle} | {data.language.displayName} Dictionary | Parhiba</title>
  <meta
    name="description"
    content="Browse {data.language.displayName} lemmas, glosses, and translations in Parhiba."
  />
</svelte:head>

<div class="page" dir={data.language.textDirection}>
  <header class="toolbar">
    <div>
      <h1 class="page-title" dir="ltr">
        <bdi lang={data.language.code} dir={data.language.textDirection}>{data.language.nativeDictionaryTitle}</bdi>
        <span lang="en">{data.language.displayName} Dictionary</span>
      </h1>
      <p class="entry-count muted" lang="en" dir="ltr">
        {data.totalCount.toLocaleString('en-US')} {data.totalCount === 1 ? 'entry' : 'entries'}
      </p>
    </div>
    <nav class="actions" aria-label="Dictionary tools">
      {#if data.canEdit}
        <Button
          href={data.language.code === 'hi'
            ? '/moderation/hindi/workshop?view=entries'
            : `/moderation/dictionary?language=${data.language.code}`}>Edit dictionary</Button
        >
        {#if data.language.code === 'hi'}
          <Button variant="primary" href="/dictionary/hi/review">Review unparsed words</Button>
        {/if}
      {:else if data.language.code === 'hi' && data.user?.role === 'curator'}
        <Button href="/moderation/hindi">Review book context</Button>
      {/if}
    </nav>
  </header>
  <form
    method="get"
    class="toolbar"
    role="search"
    data-testid="dictionary-search-form"
    bind:this={searchForm}
    onsubmit={(event) => {
      event.preventDefault();
      search();
    }}
  >
    {#each data.query.pos as pos}<input type="hidden" name="pos" value={pos} />{/each}
    {#if data.limit !== 50}<input type="hidden" name="limit" value={data.limit} />{/if}
    <div class="search-fields">
      {#key data.language.code + inputKey}
        <ScriptAwareInput
          language={data.language.code}
          name="q"
          value={data.query.q}
          placeholder={`Search ${data.language.displayName} words`}
          onNativeChange={queueSearch}
        />
      {/key}
      <Button type="submit">Search</Button>
    </div>
  </form>

  {#if data.usedRomanizationTransliteration}
    <!--
      T-3.12: the user typed Latin and we transliterated to native
      before searching. Show what we actually queried so an unexpected
      ITRANS mapping (e.g. `S` vs `Sh`) is debuggable from the UI.
    -->
    <p class="transliteration-hint" role="status" data-testid="transliteration-hint">
      Showing matches for <strong>{data.effectiveQuery}</strong>
      <span class="muted">(transliterated from {data.query.q})</span>.
    </p>
  {/if}

  {#if data.usedNuktaFallback}
    <!--
      #318: Nukta-agnostic fallback fired. Tell the user the strict
      match missed and we found these by ignoring nuktas. `ज़रा` and
      `जरा` collapse to the same key, so the user might be looking at
      a different word than they typed.
    -->
    <p class="nukta-fallback" role="status">
      No exact matches for <strong>{data.query.q}</strong>. Showing nukta-agnostic results.
    </p>
  {/if}

  {#if data.lemmas.length === 0}
    <p class="empty">No entries match.</p>
  {:else}
    <div class="entry-table-wrap">
      <table class="entry-table" aria-label="Dictionary entries">
        <thead
          ><tr
            ><th>Word</th><th>POS</th><th>Definition</th><th
              >{data.language.code === 'hi' ? 'Inflection' : 'Source'}</th
            >
            {#if data.canEdit}<th>Edit</th>{/if}
          </tr></thead
        >
        <tbody>
          {#each data.lemmas as lemma (lemma.id)}
            {@const definitionId = data.definitionIds[lemma.id]}
            <tr>
              <td class="word" lang={data.language.code}
                >{lemma.headword}
                {#if lemma.frequencyRank != null}<small title="Frequency rank"
                    >#{lemma.frequencyRank}</small
                  >{/if}
              </td>
              <td class="pos">{lemma.pos.toLowerCase()}</td>
              <td class="definition">
                {#if data.canEdit && definitionId}
                  <EditableDefinition
                    text={lemma.glossDefault ?? ''}
                    translationId={definitionId}
                    lemmaId={lemma.id}
                    canEdit
                  />
                {:else}{lemma.glossDefault ?? ''}{/if}
              </td>
              <td class="detail"
                >{data.language.code === 'hi'
                  ? patternLabel(data.patterns[lemma.id] ?? 'invariant')
                  : (lemma.sourceAttribution ?? '')}</td
              >
              {#if data.canEdit}
                <td class="edit"
                  ><a
                    href={data.language.code === 'hi'
                      ? `/moderation/hindi/workshop?id=${lemma.id}`
                      : `/moderation/dictionary/${lemma.id}`}>Edit entry</a
                  >
                  {#if data.language.code === 'hi'}<a
                      href={`/moderation/hindi/workshop?id=${lemma.id}#inflection`}
                      >Edit inflection</a
                    >{/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

  {/if}
  <Pagination offset={data.offset} limit={data.limit} total={data.totalCount} hrefFor={hrefWith} />
</div>

<style>
  .entry-count {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
  }
  .toolbar,
  .actions,
  .search-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .toolbar {
    justify-content: space-between;
    margin-bottom: 1rem;
    gap: 0.75rem;
  }
  .detail,
  .pos,
  .muted,
  small {
    color: var(--ink-2);
  }
  .word {
    font: 1.1rem var(--font-serif-dev, var(--font-serif));
    width: 22%;
  }
  small {
    font: 0.75rem var(--font-ui);
  }
  .pos {
    width: 8%;
  }
  .detail {
    width: 16%;
  }
  .edit {
    width: 12%;
  }
  .edit a {
    display: block;
  }
  @media (max-width: 639px) {
    .entry-table thead {
      position: absolute;
      clip-path: inset(50%);
      width: 1px;
      height: 1px;
      overflow: hidden;
    }
    .entry-table tbody tr {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.25rem 0.75rem;
      padding: 0.75rem;
    }
    .entry-table tbody tr + tr {
      border-top: 1px solid var(--rule);
    }
    .entry-table tbody td {
      width: auto;
      border: 0;
      padding: 0;
    }
    .definition,
    .detail,
    .edit {
      grid-column: 1 / -1;
    }
    .edit a {
      display: inline-block;
      margin-inline-end: 0.75rem;
    }
  }
  .empty {
    margin: 2rem 0;
    color: var(--color-fg-muted);
  }
  .nukta-fallback,
  .transliteration-hint {
    margin: 0 0 1rem;
    padding: 0.6rem 0.85rem;
    border-radius: 6px;
    background: var(--color-info-bg, #eef5ff);
    color: var(--color-info-fg, var(--color-fg));
    border-left: 3px solid var(--color-accent);
    font-size: 0.9rem;
  }
</style>
