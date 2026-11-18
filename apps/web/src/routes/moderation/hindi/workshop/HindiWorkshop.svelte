<script lang="ts">
  import Pagination from '$lib/components/input/Pagination.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import {
    emptyDraft,
    type Draft,
    type Match,
    type ReviewItem,
  } from '$lib/dictionary/hindi-workshop';
  import { workshop } from '$lib/dictionary/workshop-client';
  import WorkshopReports from './WorkshopReports.svelte';
  import WorkshopEditor from './WorkshopEditor.svelte';
  import type { loadHindiWorkshop } from '$lib/server/dictionary/workshop-page';
  import Button from '$lib/components/input/Button.svelte';
  type PageData = Awaited<ReturnType<typeof loadHindiWorkshop>>;
  let { data, reviewOnly = false }: { data: PageData; reviewOnly?: boolean } = $props();
  type Word = NonNullable<PageData['initial']>;
  function blank(lemma = '', pos = 'NOUN'): Word {
    return { draft: emptyDraft(lemma, pos), evidence: [], group: [], external: '', uses: [] };
  }
  let word = $state<Word>(untrack(() => data.initial ?? blank(data.observed)));
  let draft = $state<Draft>(untrack(() => structuredClone($state.snapshot(word.draft))));
  let tab = $state<'dictionary' | 'review'>(
    untrack(() => ((data.initial || data.browse) && !reviewOnly ? 'dictionary' : 'review')),
  );
  let query = $state(''),
    kind = $state(untrack(() => (reviewOnly ? 'unresolved' : ''))),
    offset = $state(0),
    refresh = $state(0);
  const limit = 40;
  const bookPreference = $derived(`parhiba.hindi.reviewBook.${page.data.user?.id}`);
  let rememberedBook = $state('');
  $effect(() => {
    try {
      rememberedBook = localStorage.getItem(bookPreference) ?? '';
    } catch {
      rememberedBook = '';
    }
  });
  const book = $derived.by(() => {
    const requested = page.url.searchParams.get('textId') ?? rememberedBook;
    return data.books.find((item) => item.id === requested)?.id ?? '';
  });

  function selectBook(selected: string) {
    const url = new URL(page.url);
    url.searchParams.set('textId', selected);
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    offset = 0;
    if (active) void open(null);
    rememberedBook = selected;
    try {
      localStorage.setItem(bookPreference, selected);
    } catch {
      message = 'Your browser could not save the selected book for next time.';
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
  const reviewBook = $derived(data.books.find((b) => b.id === (sample?.book ?? book)));
  let reprocessing = $state(false);
  async function reprocessBook() {
    if (!reviewBook || reprocessing) return;
    reprocessing = true;
    try {
      const response = await fetch(`/api/v1/admin/texts/${reviewBook.id}/reprocess`, {
        method: 'POST',
      });
      if (!response.ok)
        throw new Error((await response.json()).message || 'Could not reprocess book');
      refresh++;
      message = 'Book reprocessed';
    } catch (e) {
      message = (e as Error).message;
    } finally {
      reprocessing = false;
    }
  }
  let selection = 0;
  const drafts = new Map<string, Draft>();
  const key = () => word.draft.id ?? 'new:' + word.draft.lemma + ':' + word.draft.pos;
  function remember() {
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
  async function open(
    id: string | null,
    lemma = '',
    row: ReviewItem | null = null,
    pos = 'NOUN',
    attach = '',
  ) {
    const ticket = ++selection;
    try {
      const next = id ? await workshop<Word>('word', { id }) : blank(lemma, pos);
      if (ticket !== selection) return;
      remember();
      display(next, row);
      if (attach && !draft.other.includes(attach)) draft.other = [...draft.other, attach];
    } catch (e) {
      if (ticket === selection) message = (e as Error).message;
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
      (r) => r.word === row.word && r.id === row.id && r.kind === row.kind,
    );
    const next = index >= 0 ? queue[index + 1] : null;
    if (next && index + 1 === limit && !removed) offset += limit;
    await open(next?.id ?? null, next?.word ?? '', next ?? null);
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
        } else {
          const result = await workshop<{ rows: ReviewItem[]; total: number }>(
            'queue',
            { query: q, book: b || null, kind: k, limit: limit + 1, offset: start },
            ctrl.signal,
          );
          if (ctrl.signal.aborted) return;
          if (!result.rows.length && start > 0) offset = Math.max(0, start - limit);
          queue = result.rows;
          total = result.total;
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
      <h1 class="page-title">{reviewOnly ? 'Hindi dictionary' : 'Dictionary workshop'}</h1>
    </div>
    <div class="controls">
      <Button href="/dictionary/hi">Browse entries</Button>
      <Button href="/moderation/hindi?kind=ambiguous">Review ambiguous words</Button>
    </div>
  </header>
  {#if !reviewOnly}<WorkshopReports
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
          onchange={(event) => selectBook(event.currentTarget.value)}
          ><option value="">All books</option>{#each data.books as b}<option value={b.id}
              >{b.title}</option
            >{/each}</select
        >
        <select
          aria-label="Review type"
          bind:value={kind}
          onchange={() => {
            offset = 0;
            if (active) void open(null);
          }}
          ><option value="">All items</option><option value="unresolved">Unresolved forms</option
          ><option value="missing-definition">Missing definitions</option><option value="ignored"
            >Ignored in books</option
          ></select
        >
      {/if}
      <input
        type="search"
        aria-label="Search words"
        placeholder={tab === 'dictionary' ? 'Search Hindi or English' : 'Find a word'}
        bind:value={query}
        oninput={() => {
          offset = 0;
        }}
      />
      <div class="controls">
        <Button
          disabled={working}
          onclick={() => open(null, query.match(/\p{Script=Devanagari}/u) ? query : '')}
        >New entry</Button>
        <Button onclick={() => refresh++}>Refresh</Button>
        {#if tab === 'review' && reviewBook?.canReprocess}
          <Button disabled={reprocessing} title={reviewBook.title} onclick={reprocessBook}>
            {reprocessing ? 'Reprocessing…' : 'Reprocess book'}
          </Button>
        {/if}
      </div>
      <div class="results" aria-busy={pending}>
        {#if tab === 'dictionary'}
          {#each rows.slice(0, limit) as row}<button
              class:chosen={word.draft.id === row.id}
              disabled={working || pending}
              onclick={() => open(row.id)}
              ><strong lang="hi">{row.lemma}</strong> <small>{row.pos}</small><span
                >{row.meaning}</span
              ></button
            >{/each}
          {#if !rows.length && !pending}<p>No matching entries.</p>{/if}
        {:else}
          {#each queue.slice(0, limit) as row}<button
              class:chosen={active?.word === row.word &&
                active?.kind === row.kind &&
                active?.id === row.id}
              disabled={working || pending}
              onclick={() => open(row.id, row.word, row)}
              ><strong lang="hi">{row.word}</strong>
              {#if row.pos}<small>{row.pos.toLowerCase()}</small>{/if}
              <small>{row.count}</small><span
                >{row.kind === 'missing-definition'
                  ? 'Missing definition'
                  : row.kind === 'ignored'
                    ? 'Ignored'
                    : 'Unresolved'}</span
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
    <article>
      {#if active && sample}<div class="context">
          <strong lang="hi">{active.word}</strong>
          {#if active.samples.length > 1}
            <select aria-label="Example book" bind:value={sampleBook}>
              {#each active.samples as example}
                <option value={example.book}
                  >{data.books.find((b) => b.id === example.book)?.title} ({example.count})</option
                >
              {/each}
            </select>
          {/if}
          <a
            href={'/reader/' +
              sample.book +
              '?chapter=' +
              sample.chapter +
              '&token=' +
              sample.token}>{data.books.find((b) => b.id === sample?.book)?.title}</a
          >
          <p lang="hi">{sample.context.before}<mark>{sample.context.match}</mark>{sample.context.after}</p>
          {#if active.kind !== 'missing-definition'}<button disabled={working} onclick={ignore}
              >{active.kind === 'ignored' ? 'Restore in this book' : 'Ignore in this book'}</button
            >{/if}
        </div>{/if}
      {#key generation}
        <WorkshopEditor
          bind:draft
          bind:working
          {word}
          ai={data.ai}
          observed={active?.word ?? data.observed}
          review={!!active}
          onsaved={saved}
          onopen={(id, lemma, pos, attach) => open(id, lemma, active, pos, attach)}
          ondeleted={() => {
            drafts.delete(key());
            display(blank(), null, false);
            refresh++;
            message = 'Entry deleted';
          }}
        />
      {/key}
      {#if message}<p role="status">{message}</p>{/if}
    </article>
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
    gap: 0.65rem;
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
  a {
    color: var(--accent);
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
