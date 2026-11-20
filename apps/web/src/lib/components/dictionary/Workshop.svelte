<script lang="ts">
  import Pagination from '$lib/components/input/Pagination.svelte';
  import { getToastStore } from '$lib/components/toast/toast-store.js';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import {
    blankWorkshopWord,
    type WorkshopWord as Word,
    type Draft,
    type Match,
    type ReviewItem,
  } from '$lib/dictionary/workshop';
  import { workshop as send } from '$lib/dictionary/workshop-client';
  import WorkshopReports from './WorkshopReports.svelte';
  import WorkshopEditor from '$lib/components/dictionary/WorkshopEditor.svelte';
  import type { loadWorkshop } from '$lib/server/dictionary/workshop-page';
  import { reprocessWithToast } from '$lib/text/reprocess.js';
  import Button from '$lib/components/input/Button.svelte';

  const toastStore = getToastStore();
  import { dictionaryProfile } from '$lib/dictionary/profiles';
  type PageData = Awaited<ReturnType<typeof loadWorkshop>>;
  let { data, reviewOnly = false }: { data: PageData; reviewOnly?: boolean } = $props();
  const language = $derived(data.language.code);
  const scriptLetters = $derived(new RegExp('\\p{Script=' + data.language.script + '}', 'u'));
  const profile = $derived(dictionaryProfile(language));
  function workshop<T>(action: string, fields: Record<string, unknown>, signal?: AbortSignal) {
    return send<T>(action, fields, signal, language);
  }
  let word = $state<Word>(untrack(() => data.initial ?? blankWorkshopWord(data.observed)));
  let draft = $state<Draft>(untrack(() => structuredClone($state.snapshot(word.draft))));
  let selectionSource = $state<'none' | 'editor' | 'list'>(
    untrack(() => data.initial || data.observed ? 'editor' : 'none'),
  );
  let tab = $state<'dictionary' | 'review'>(
    untrack(() => ((data.initial || data.browse) && !reviewOnly ? 'dictionary' : 'review')),
  );
  let query = $state(''),
    offset = $state(0),
    refresh = $state(0);
  const limit = 40;
  const bookPreference = $derived(`parhiba.${profile.preferenceKey ?? language}.reviewBook.${page.data.user?.id}`);
  const kindPreference = $derived(`parhiba.${profile.preferenceKey ?? language}.reviewKind.${page.data.user?.id}`);
  const reviewTypes = $derived([
    { value: '', label: 'All items' },
    { value: 'unresolved', label: 'Unresolved forms' },
    { value: 'stutter', label: 'Possible stutters' },
    { value: 'missing-definition', label: 'Missing definitions' },
    { value: 'ignored', label: 'Ignored in books' },
  ].filter(item => item.value !== 'stutter' || data.stutterReview));
  let rememberedBook = $state('');
  let rememberedKind = $state<string | null>(null);
  $effect(() => {
    try {
      rememberedBook = localStorage.getItem(bookPreference) ?? '';
      rememberedKind = localStorage.getItem(kindPreference);
    } catch {
      rememberedBook = '';
      rememberedKind = null;
    }
  });
  const book = $derived.by(() => {
    const requested = page.url.searchParams.get('textId') ?? rememberedBook;
    return data.books.find((item) => item.id === requested)?.id ?? '';
  });

  const kind = $derived.by(() => {
    const requested = page.url.searchParams.get('kind') ?? rememberedKind;
    return reviewTypes.find(type => type.value === requested)?.value ?? (reviewOnly ? 'unresolved' : '');
  });

  function selectFilter(param: 'textId' | 'kind', selected: string) {
    const url = new URL(page.url);
    url.searchParams.set(param, selected);
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    offset = 0;
    if (active) {
      remember();
      clearSelection();
    }
    if (param === 'textId') rememberedBook = selected;
    else rememberedKind = selected;
    try {
      localStorage.setItem(param === 'textId' ? bookPreference : kindPreference, selected);
    } catch {
      message = 'Your browser could not save this filter for next time.';
    }
  }
  let rows = $state<Match[]>([]),
    queue = $state<ReviewItem[]>([]),
    total = $state(0),
    pending = $state(false);
  let active = $state<ReviewItem | null>(null),
    message = $state(''),
    working = $state(false),
    generation = $state(0);
  let sampleBook = $state('');
  const sample = $derived(active?.samples.find((s) => s.book === sampleBook) ?? active?.samples[0]);
  function stutterQuestion({ before, match, after }: ReviewItem['samples'][number]['context']) {
    return 'Does the marked ' + data.language.displayName + ' expression represent a speaker stuttering? Consider ordinary repetition and compounds too. ' +
      'Answer in English with “Stutter”, “Keep separate”, or “Uncertain”. Give a brief reason and, if it is a stutter, identify the intended word.\n\n' +
      `${before}【${match}】${after}`.trim();
  }
  const reviewBook = $derived(data.books.find((b) => b.id === (sample?.book ?? book)));
  let mounted = $state(false);
  onMount(() => { mounted = true; });
  let reprocessing = $state(false);
  async function reprocessBook() {
    if (!reviewBook?.canReprocess || reprocessing) return;
    reprocessing = true;
    try {
      if (await reprocessWithToast(reviewBook, toastStore)) refresh++;
    } finally {
      reprocessing = false;
    }
  }
  let selection = 0;
  let openingManually = false;
  const drafts = new Map<string, Draft>();
  const key = () => word.draft.id ?? 'new:' + word.draft.lemma + ':' + word.draft.pos;
  function remember() {
    if (selectionSource === 'none') return;
    if (JSON.stringify(word.draft) !== JSON.stringify(draft))
      drafts.set(key(), $state.snapshot(draft));
    else drafts.delete(key());
  }
  function display(w: Word, row: ReviewItem | null, restore = true) {
    word = w;
    if (!row || row !== active) sampleBook = row?.samples[0]?.book ?? '';
    active = row;
    draft = structuredClone(
      drafts.get(key()) && restore ? drafts.get(key())! : $state.snapshot(w.draft),
    );
    generation++;
    message = '';
  }
  function clearSelection() {
    selection++;
    openingManually = false;
    selectionSource = 'none';
    display(blankWorkshopWord(), null, false);
  }
  async function open(
    id: string | null,
    { lemma = '', row = null, pos = 'NOUN', attach = '', fromList = false, signal }: {
      lemma?: string;
      row?: ReviewItem | null;
      pos?: string;
      attach?: string;
      fromList?: boolean;
      signal?: AbortSignal;
    } = {},
  ) {
    const ticket = ++selection;
    openingManually = !signal;
    try {
      const next = id ? await workshop<Word>('word', { id }, signal) : blankWorkshopWord(lemma, pos);
      if (ticket !== selection || signal?.aborted) return;
      remember();
      display(next, row);
      selectionSource = fromList ? 'list' : 'editor';
      if (attach && !draft.other.includes(attach)) draft.other = [...draft.other, attach];
    } catch (e) {
      if (ticket === selection && !signal?.aborted) message = (e as Error).message;
    } finally {
      if (ticket === selection) openingManually = false;
    }
  }
  function openResult(result: Match | ReviewItem, signal?: AbortSignal) {
    const row = 'word' in result ? result : null;
    return open(result.id, { lemma: row?.word, row, fromList: true, signal });
  }
  function isSelected(result: Match | ReviewItem) {
    if ('word' in result) return active?.word === result.word && active.kind === result.kind
      && active.id === result.id && active.occurrence === result.occurrence;
    return !active && word.draft.id === result.id;
  }
  async function selectFirstIfNeeded(results: (Match | ReviewItem)[], signal: AbortSignal) {
    if (openingManually) return;
    const selected = results.slice(0, limit).find(isSelected);
    if (selected) {
      if ('samples' in selected) {
        active = selected;
        if (!selected.samples.some((item) => item.book === sampleBook)) {
          sampleBook = selected.samples[0]?.book ?? '';
        }
      }
      return;
    }
    if (selectionSource === 'editor') return;
    if (results[0]) await openResult(results[0], signal);
    else if (selectionSource === 'list') {
      remember();
      clearSelection();
    }
  }
  async function saved(w: Word, advance = false) {
    drafts.delete(key());
    display(w, active, false);
    message = 'Saved';
    refresh++;
    if (advance && active) {
      await openFollowing(active, active.kind === 'missing-definition' && !!w.draft.meaning.trim());
    }
  }
  async function openFollowing(row: ReviewItem, removed: boolean) {
    const index = queue.findIndex(
      (r) => r.word === row.word && r.id === row.id && r.kind === row.kind && r.occurrence === row.occurrence,
    );
    const next = index >= 0 ? queue[index + 1] : null;
    if (next && index + 1 === limit && !removed) offset += limit;
    if (next) await openResult(next);
    else {
      remember();
      clearSelection();
    }
  }
  async function decideStutter(confirm: boolean) {
    if (!active || !sample || working) return;
    working = true;
    try {
      await workshop('stutter', { chapter: sample.chapterId, start: sample.start,
        surface: active.word, hash: sample.hash, confirm });
      await openFollowing(active, true);
      refresh++;
      if (confirm) toastStore.pushToast({ kind: 'success', message: 'Stutter confirmed' });
      else message = 'Kept as separate words';
    } catch (e) {
      message = (e as Error).message;
    } finally {
      working = false;
    }
  }
  async function ignore() {
    if (!active || !sample) return;
    working = true;
    try {
      const row = active;
      await workshop('ignore', {
        book: sample.book,
        word: row.word,
        ignore: row.kind !== 'ignored',
      });
      await openFollowing(row, row.samples.length === 1);
      refresh++;
      message = row.kind === 'ignored' ? 'Restored to review' : 'Ignored in this book';
    } catch (e) {
      message = (e as Error).message;
    } finally {
      working = false;
    }
  }
  $effect(() => {
    const view = tab,
      q = query,
      b = book,
      k = kind,
      start = offset;
    // Track explicit refreshes alongside the search filters.
    void refresh;
    const ctrl = new AbortController();
    pending = true;
    const timer = setTimeout(async () => {
      try {
        if (view === 'dictionary') {
          const matches = await workshop<Match[]>('search', { query: q, limit: limit + 1, offset: start }, ctrl.signal);
          if (ctrl.signal.aborted) return;
          rows = matches;
          if (!rows.length && start > 0) offset = Math.max(0, start - limit);
          else await selectFirstIfNeeded(matches, ctrl.signal);
        } else {
          const result = await workshop<{ rows: ReviewItem[]; total: number }>(
            'queue',
            { query: q, book: b || null, kind: k, limit: limit + 1, offset: start },
            ctrl.signal,
          );
          if (ctrl.signal.aborted) return;
          queue = result.rows;
          total = result.total;
          if (!result.rows.length && start > 0) offset = Math.max(0, start - limit);
          else await selectFirstIfNeeded(result.rows, ctrl.signal);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) message = (e as Error).message;
      } finally {
        if (!ctrl.signal.aborted) pending = false;
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });
</script>

<div class="workshop">
  <header>
    <div>
      <h1 class="page-title">{reviewOnly ? data.language.displayName + ' dictionary' : 'Dictionary workshop'}</h1>
    </div>
    <div class="controls">
      <Button href={'/dictionary/' + language}>Browse entries</Button>
      {#if profile.reviewHref}<Button href={profile.reviewHref(page.url, book)}>Review book context</Button>{/if}
    </div>
  </header>
  {#if !reviewOnly && data.reports.length}<WorkshopReports {language}
      reports={data.reports}
      open={(id) => open(id)}
      changed={() => {
        refresh++;
      }}
    />{/if}
  <div class="panes">
    <aside>
      {#if reviewOnly}
        <h2>Book review <small>{total.toLocaleString()}</small></h2>
      {:else}
        <nav aria-label="Workshop views">
          {#each ['dictionary', 'review'] as const as name}<button
              class:current={tab === name}
              onclick={() => {
                tab = name;
                query = '';
                offset = 0;
              }}
              >{name === 'dictionary' ? 'Dictionary' : 'Review'}{#if name === 'review' && total}
                <small>{total.toLocaleString()}</small>{/if}</button
            >{/each}
        </nav>
      {/if}
      {#if tab === 'review'}
        <select
          aria-label="Review book"
          value={book}
          onchange={(event) => selectFilter('textId', event.currentTarget.value)}
          ><option value="">All books</option>{#each data.books as b}<option value={b.id}
              >{b.title}</option
            >{/each}</select
        >
        <select
          aria-label="Review type"
          value={kind}
          onchange={(event) => selectFilter('kind', event.currentTarget.value)}
        >
          {#each reviewTypes as type}
            <option value={type.value}>{type.label}</option>
          {/each}
        </select>
      {/if}
      <input
        type="search"
        aria-label="Search words"
        placeholder={tab === 'dictionary' ? 'Search ' + data.language.displayName + ' or English' : 'Find a word'}
        bind:value={query}
        oninput={() => {
          offset = 0;
        }}
      />
      <div class="controls">
        <Button
          disabled={!mounted || working}
          onclick={() => open(null, { lemma: scriptLetters.test(query) ? query : '' })}
        >New entry</Button>
        <Button disabled={pending} onclick={() => refresh++}>{pending ? 'Refreshing…' : 'Refresh'}</Button>
        {#if tab === 'review' && reviewBook?.canReprocess}
          <Button disabled={!mounted || reprocessing} title={reviewBook.title} onclick={reprocessBook}>
            {reprocessing ? 'Reprocessing…' : 'Reprocess book'}
          </Button>
        {/if}
      </div>
      <div class="results" aria-busy={pending}>
        {#if tab === 'dictionary'}
          {#each rows.slice(0, limit) as row}<button
              class:chosen={isSelected(row)}
              disabled={working || pending}
              onclick={() => openResult(row)}
              ><strong lang={language} dir="auto">{row.lemma}</strong> <small>{row.pos}</small><span
                >{row.meaning}</span
              ></button
            >{/each}
          {#if !rows.length && !pending}<p>No matching entries.</p>{/if}
        {:else}
          {#each queue.slice(0, limit) as row}<button
              class:chosen={isSelected(row)}
              disabled={working || pending}
              onclick={() => openResult(row)}
              ><strong lang={language} dir="auto">{row.word}</strong>
              {#if row.pos}<small>{row.pos.toLowerCase()}</small>{/if}
              <small>{row.count}</small><span
                >{row.kind === 'missing-definition'
                  ? 'Missing definition'
                  : row.kind === 'ignored'
                    ? 'Ignored'
                    : row.kind === 'stutter' ? 'Possible stutter' : 'Unresolved'}</span
              ></button
            >{/each}
          {#if !queue.length && !pending}<p>No items in this view.</p>{/if}
        {/if}
      </div>
      {#if (tab === 'review' ? total : rows.length) || offset}
        <Pagination {offset} {limit} total={tab === 'review' ? total : undefined}
          hasNext={rows.length > limit} disabled={pending || working} onPage={(next) => (offset = next)} />
      {/if}
    </aside>
    {#if selectionSource !== 'none' || message}<article>
      {#if active && sample}<div class="context">
          <div class="context-heading">
          <strong lang={language} dir="auto">{active.word}</strong>
          {#if active.samples.length > 1}
            <select aria-label="Example book" bind:value={sampleBook}>
              {#each active.samples as example}
                <option value={example.book}
                  >{data.books.find((b) => b.id === example.book)?.title} ({example.count})</option
                >
              {/each}
            </select>
          {/if}
          <div class="context-links">
            {#if active.kind === 'stutter'}
              <Button href={'https://chatgpt.com/?q=' + encodeURIComponent(stutterQuestion(sample.context))}
                target="_blank" rel="noreferrer">Ask ChatGPT ↗</Button>
            {/if}
            <Button title={reviewBook?.title}
              href={`/reader/${sample.book}?chapter=${sample.chapter}&token=${sample.token}`}>View in text</Button>
          </div>
          </div>
          <p lang={language} dir="auto">{sample.context.before}<mark>{sample.context.match}</mark>{sample.context.after}</p>
          {#if active.kind === 'stutter'}
            <div class="stutter-actions">
              <Button disabled={working} onclick={() => decideStutter(true)}>Confirm stutter</Button>
              <Button disabled={working} onclick={() => decideStutter(false)}>Keep separate</Button>
            </div>
          {:else if active.kind !== 'missing-definition'}<button disabled={working} onclick={ignore}
              >{active.kind === 'ignored' ? 'Restore in this book' : 'Ignore in this book'}</button
            >{/if}
        </div>{/if}
      {#if selectionSource !== 'none' && active?.kind !== 'stutter'}{#key generation}
        <WorkshopEditor
          {language}
          bind:draft
          bind:working
          {word}
          context={sample?.context}
          observed={active?.word ?? data.observed}
          review={!!active}
          onsaved={saved}
          onopen={(id, lemma, pos, attach) => open(id, { lemma, row: active, pos, attach })}
          ondeleted={() => {
            drafts.delete(key());
            clearSelection();
            refresh++;
            message = 'Entry deleted';
          }}
        />
      {/key}{/if}
      {#if message}<p role="status">{message}</p>{/if}
    </article>{/if}
  </div>
</div>

<style>
  header,
  nav,
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
  }
  .controls {
    flex-wrap: wrap;
  }
  header {
    margin-bottom: 1.2rem;
  }

  h2 {
    font-size: 1rem;
    margin: 0;
  }
  header {
    flex-wrap: wrap;
  }
  .panes {
    display: grid;
    grid-template-columns: minmax(15rem, 27%) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  aside,
  article {
    background: var(--card);
    border: 1px solid var(--rule);
    border-radius: 0.65rem;
    padding: 1.1rem;
    min-width: 0;
  }
  aside {
    position: sticky;
    top: 0.5rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.65rem;
  }
  aside > select,
  aside > input {
    width: 100%;
    min-width: 0;
  }
  .context-heading select {
    max-width: 100%;
  }
  button,
  input,
  select {
    font: inherit;
    color: inherit;
    border: 1px solid var(--rule);
    background: var(--paper);
    padding: 0.45rem 0.65rem;
    border-radius: 0.4rem;
  }
  button {
    cursor: pointer;
  }
  nav button {
    flex: 1;
  }
  button.current,
  button.chosen {
    border-color: var(--accent);
    background: var(--surface-2, var(--paper));
  }
  .results {
    max-height: 62vh;
    overflow: auto;
  }
  .results button {
    display: block;
    border: 0;
    border-bottom: 1px solid var(--rule);
    border-radius: 0;
    text-align: start;
    width: 100%;
    background: transparent;
  }
  .results button.chosen {
    box-shadow: inset 3px 0 var(--accent);
  }
  .results span {
    display: block;
    font-size: 0.84rem;
    color: var(--ink-3);
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }
  .context {
    padding: 0.6rem;
    border-bottom: 1px solid var(--rule);
  }
  .context mark {
    background: var(--accent-soft);
    color: var(--ink);
    border-bottom: 2px solid var(--accent);
  }
  small {
    font-size: 0.75rem;
  }
  .context-heading, .context-links, .stutter-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .context-links {
    margin-inline-start: auto;
    justify-content: flex-end;
  }
  @media (max-width: 760px) {
    .panes {
      grid-template-columns: 1fr;
    }
    aside {
      position: static;
    }
    .results {
      max-height: 11rem;
    }
    article {
      padding: 0.85rem;
    }
    header {
      align-items: end;
    }
  }
</style>
