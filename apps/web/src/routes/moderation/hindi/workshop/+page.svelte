<script lang="ts">
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
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  type Word = NonNullable<PageData['initial']>;
  function blank(lemma = '', pos = 'NOUN'): Word {
    return { draft: emptyDraft(lemma, pos), evidence: [], group: [], external: '', uses: [] };
  }
  let word = $state<Word>(untrack(() => data.initial ?? blank(data.observed)));
  let draft = $state<Draft>(untrack(() => structuredClone($state.snapshot(word.draft))));
  let tab = $state<'dictionary' | 'review'>(
    untrack(() => (data.initial ? 'dictionary' : 'review')),
  );
  let query = $state(''),
    book = $state(''),
    kind = $state(''),
    limit = $state(40),
    refresh = $state(0);
  let rows = $state<Match[]>([]),
    queue = $state<ReviewItem[]>([]),
    total = $state(0),
    pending = $state(false);
  let active = $state<ReviewItem | null>(null),
    message = $state(''),
    working = $state(false),
    generation = $state(0);
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
      const i = queue.findIndex((r) => r.word === active?.word && r.id === active?.id);
      const next = i >= 0 ? queue[i + 1] : null;
      if (next) await open(next.id, next.word, next);
    }
  }
  async function ignore() {
    if (!active) return;
    working = true;
    try {
      const row = active;
      await workshop('ignore', { book: row.book, word: row.word, ignore: row.kind !== 'ignored' });
      const i = queue.findIndex((r) => r.word === row.word && r.kind === row.kind);
      const next = queue[i + 1];
      await open(next?.id ?? null, next?.word ?? '', next ?? null);
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
      n = limit;
    refresh;
    const ctrl = new AbortController();
    pending = true;
    const timer = setTimeout(async () => {
      try {
        if (view === 'dictionary') {
          rows = await workshop<Match[]>('search', { query: q, limit: n }, ctrl.signal);
        } else {
          const result = await workshop<{ rows: ReviewItem[]; total: number }>(
            'queue',
            { query: q, book: b || null, kind: k, limit: n },
            ctrl.signal,
          );
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

<svelte:head><title>Hindi dictionary workshop | Parhiba</title></svelte:head>
<div class="workshop">
  <header>
    <div>
      <a href="/dictionary/hi">Hindi dictionary</a>
      <h1 class="page-title">Dictionary workshop</h1>
    </div>
    <a href="/moderation/hindi?kind=ambiguous">Review ambiguous words</a>
  </header>
  <WorkshopReports
    reports={data.reports}
    open={(id) => open(id)}
    changed={() => {
      refresh++;
    }}
  />
  <div class="panes">
    <aside>
      <nav aria-label="Workshop views">
        {#each ['dictionary', 'review'] as const as name}<button
            class:current={tab === name}
            onclick={() => {
              tab = name;
              query = '';
              limit = 40;
            }}
            >{name === 'dictionary' ? 'Dictionary' : 'Review'}{#if name === 'review' && total}
              <small>{total.toLocaleString()}</small>{/if}</button
          >{/each}
      </nav>
      {#if tab === 'review'}
        <select aria-label="Review book" bind:value={book} onchange={() => (limit = 40)}
          ><option value="">All books</option>{#each data.books as b}<option value={b.id}
              >{b.title}</option
            >{/each}</select
        >
        <select aria-label="Review type" bind:value={kind} onchange={() => (limit = 40)}
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
        oninput={() => (limit = 40)}
      />
      <div class="controls">
        <button
          disabled={working}
          onclick={() => open(null, query.match(/\p{Script=Devanagari}/u) ? query : '')}
          >New entry</button
        ><button onclick={() => refresh++}>Refresh</button>
      </div>
      <div class="results" aria-busy={pending}>
        {#if tab === 'dictionary'}
          {#each rows as row}<button
              class:chosen={word.draft.id === row.id}
              disabled={working}
              onclick={() => open(row.id)}
              ><strong lang="hi">{row.lemma}</strong> <small>{row.pos}</small><span
                >{row.meaning}</span
              ></button
            >{/each}
          {#if !rows.length && !pending}<p>No matching entries.</p>{/if}
        {:else}
          {#each queue as row}<button
              class:chosen={active?.word === row.word &&
                active?.kind === row.kind &&
                active?.id === row.id}
              disabled={working}
              onclick={() => open(row.id, row.word, row)}
              ><strong lang="hi">{row.word}</strong> <small>{row.count}</small><span
                >{row.kind === 'missing-definition'
                  ? 'Missing definition'
                  : row.kind === 'ignored'
                    ? 'Ignored'
                    : 'Unresolved'}</span
              ></button
            >{/each}
          {#if !queue.length && !pending}<p>No items in this view.</p>{/if}
        {/if}
        {#if (tab === 'review' ? total > limit : rows.length === limit) && limit < 2000}<button
            onclick={() => (limit = Math.min(2000, limit + 80))}>Show more</button
          >{/if}
      </div>
    </aside>
    <article>
      {#if active}<div class="context">
          <a
            href={'/reader/' +
              active.book +
              '?chapter=' +
              active.chapter +
              '&token=' +
              active.token}>{data.books.find((b) => b.id === active?.book)?.title}</a
          >
          <p lang="hi">{active.context}</p>
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
  header {
    margin-bottom: 1.2rem;
  }

  .panes {
    display: grid;
    grid-template-columns: minmax(15rem, 27%) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  aside,
  article {
    background: var(--surface, var(--paper));
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
    header a {
      font-size: 0.84rem;
    }
  }
</style>
