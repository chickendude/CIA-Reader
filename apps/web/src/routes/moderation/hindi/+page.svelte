<script lang="ts">
  import PageLayout from '$lib/components/shell/PageLayout.svelte';
  import FilterDropdown from '$lib/components/input/FilterDropdown.svelte';
  import TextField from '$lib/components/input/TextField.svelte';
  import { reviewStatusLabels, reviewFilters, type ReviewFilter } from '$lib/dictionary/review-status';
  import { onDestroy, onMount } from 'svelte';
  import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
  import Button from '$lib/components/input/Button.svelte';
  import Pagination from '$lib/components/input/Pagination.svelte';
  import SubpageHeading from '$lib/components/shell/SubpageHeading.svelte';
  import ContextChoiceButton from '$lib/components/reader/ContextChoiceButton.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let busy = $state(false);
  let message = $state('');
  const rows = $derived(data.result?.occurrences ?? []);
  const queue = $derived(rows.filter(({ token, status, spanEntries }, index) =>
    token.canVerifyContext && token.lemmaId && token.candidates.length > 0
    && spanEntries.length === token.candidates.length + 1
    && status !== 'unparsed' && status !== 'none_fit' && status !== 'uncertain'
    && rows.findIndex(row => row.token.id === token.id) === index
    && !token.selectedBy && !token.candidates.some((candidate) => candidate.selectedBy),
  ).slice(0, 5));
  let draft = $state<string | null>(null);
  const word = $derived(draft ?? data.query);
  let timer: ReturnType<typeof setTimeout>;
  let composing = false;
  let searchVersion = 0;

  beforeNavigate(({ type }) => {
    if (type === 'link' || type === 'popstate') {
      clearTimeout(timer);
      searchVersion++;
      draft = null;
    }
  });
  onDestroy(() => clearTimeout(timer));

  onMount(() => {
    const refresh = () => void invalidateAll();
    window.addEventListener('hindi-context-choice-changed', refresh);
    return () => window.removeEventListener('hindi-context-choice-changed', refresh);
  });

  function link(status: ReviewFilter = data.status, textId = data.result?.book.id ?? '', offset = 0) {
    const params = new URLSearchParams({ textId, returnTo: data.destination.href });
    if (status !== 'attention') params.set('status', status);
    if (word) params.set('q', word);
    if (offset) params.set('offset', String(offset));
    return `?${params}`;
  }

  function queueSearch(value: string) {
    draft = value;
    const version = ++searchVersion;
    clearTimeout(timer);
    if (composing) return;
    timer = setTimeout(async () => {
      await goto(link(), { replaceState: true, keepFocus: true, noScroll: true });
      if (version === searchVersion) draft = null;
    }, value ? 180 : 0);
  }

  async function runAi() {
    busy = true;
    let saved = 0;
    const batch = [...queue];
    try {
      for (const row of batch) {
        message = `Checking ${saved + 1} of ${batch.length}…`;
        const res = await fetch(`/api/v1/tokens/${row.token.id}/hindi-context/ai`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).message ?? 'AI verification failed');
        saved++;
      }
      message = `Saved ${saved} AI suggestions.`;
    } catch (e) {
      message = `${saved} saved. ${(e as Error).message}`;
    } finally {
      if (saved) await invalidateAll();
      busy = false;
    }
  }
</script>

<svelte:head><title>Hindi dictionary review | Parhiba</title></svelte:head>

{#snippet heading()}
  <SubpageHeading title="Hindi dictionary review" href={data.destination.href} closeLabel={data.destination.label} />
{/snippet}

<PageLayout {heading}>
<div class="review-page">
  <div class="heading">
    {@render heading()}
    <Button href={`/moderation/hindi/workshop${data.result ? '?textId=' + data.result.book.id : ''}`}>Open dictionary workshop</Button>
  </div>

  {#if data.result}
    <div class="filters">
      <div class="field book-field"><span>Book</span>
        <FilterDropdown label="Book" value={data.result.book.id} options={data.books.map(book => ({
          value: book.id, label: book.title + (book.visibility === 'official' ? ' (Official)' : ''),
          href: link(data.status, book.id),
        }))} />
      </div>
      <label class="field">Word
        <TextField type="search" lang="hi" name="q" maxlength={200} value={word}
          oninput={event => queueSearch(event.currentTarget.value)}
          oncompositionstart={() => { composing = true; clearTimeout(timer); }}
          oncompositionend={event => { composing = false; queueSearch(event.currentTarget.value); }} />
      </label>
      <div class="field"><span>Review status</span>
        <FilterDropdown label="Review status" value={data.status} options={reviewFilters.map(status => ({
          value: status, label: reviewStatusLabels[status],
          detail: (data.result?.attentionCounts?.[status] ?? 0).toLocaleString(), href: link(status),
        }))} />
      </div>
    </div>

    <div class="summary">
      {#if rows.length}
        <Button disabled={busy || !data.aiConfigured || queue.length === 0} onclick={() => void runAi()}>
          {busy ? 'Checking…' : `AI check next ${queue.length}`}
        </Button>
      {/if}
    </div>
    {#if !rows.length}<p class="count">No occurrences match this filter.</p>{/if}
    {#if rows.length}<p class="hint">{data.aiConfigured
      ? `AI checks send the passages and candidate definitions to ${data.aiModel}.`
      : 'Set OPENAI_API_KEY to enable AI checks.'}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    {#each rows as { token, chapterIdx, context, surface, status, key, spanEntries } (key)}
      {@const candidates = [{ lemmaId: token.lemmaId, headword: token.headword ?? token.surface, pos: token.pos ?? '', glossDefault: token.glossDefault, selectedBy: token.selectedBy }, ...token.candidates].filter(c => c.lemmaId && spanEntries.includes(c.lemmaId))}
      <article>
        <header>
          <h2 lang="hi">{surface}</h2>
          <span class="status">{reviewStatusLabels[status]}</span>
          <a href={`/reader/${data.result.book.id}?chapter=${chapterIdx}&token=${token.idx}`}>Read context</a>
        </header>
        <p class="sentence" lang="hi">{context.before}<mark>{context.match}</mark>{context.after}</p>
        {#if status === 'unparsed' || candidates.length === 0}
          <Button href={`/moderation/hindi/workshop?word=${encodeURIComponent(surface)}`}>Find dictionary entry</Button>
        {:else}
        {#each candidates as candidate}
          {#if candidate.lemmaId}<div class="candidate">
            <div><strong lang="hi">{candidate.headword}</strong> <small>{candidate.pos}</small>
              {#if candidate.glossDefault}<p>{candidate.glossDefault}</p>{/if}
            </div>
            <ContextChoiceButton {token} lemmaId={candidate.lemmaId} label={`${candidate.headword} ${candidate.pos}`} selectedBy={candidate.selectedBy} />
          </div>{/if}
        {/each}
        {/if}
      </article>
    {/each}
    <Pagination offset={data.result.offset} limit={20} total={data.result.total} hrefFor={(offset) => link(data.status, data.result!.book.id, offset)} />
  {:else}<p>No Hindi books are available for review.</p>{/if}
</div>
</PageLayout>

<style>
  .review-page { max-width: 64rem; }
  .heading, .summary, header, .candidate {
    display: flex; align-items: center; flex-wrap: wrap; gap: .65rem 1rem;
  }
  .heading, .summary, .candidate { justify-content: space-between; }
  .heading { margin-bottom: 1rem; }
  .heading :global(header) { margin-bottom: 0; }
  .filters {
    container-type: inline-size;
    display: grid; grid-template-columns: minmax(0, 12rem) repeat(2, minmax(0, 18rem));
    align-items: end; gap: .65rem 1rem; padding-block: 1rem; border-block: 1px solid var(--rule);
  }
  .field { display: grid; gap: .25rem; min-width: 0; color: var(--ink-2); font-size: .85rem; }
  .book-field { max-inline-size: 12rem; --filter-menu-width: max-content; }
  @media (max-width: 44rem) {
    .filters { grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
  }
  .count { margin: 0; color: var(--ink-2); font-size: .9rem; }
  .summary { margin: 1rem 0; }
  .hint, .status, small { font-size: .8rem; color: var(--ink-3); }
  .hint { margin: -.35rem 0 1rem; }
  article {
    margin: .85rem 0; padding: clamp(.85rem, 2vw, 1.35rem);
    border: 1px solid var(--card-edge); border-radius: 12px; background: var(--card);
  }
  h2 { margin: 0; font: 600 1.35rem/1.4 var(--font-serif); }
  header a { margin-inline-start: auto; font-size: .85rem; }
  .sentence { margin: .65rem 0; line-height: 1.75; font-size: 1.1rem; overflow-wrap: anywhere; }
  mark { background: var(--accent-soft); color: var(--ink); border-bottom: 2px solid var(--accent); }
  .candidate { padding: .6rem 0; border-top: 1px solid var(--rule); }
  .candidate > div { flex: 1 1 12rem; overflow-wrap: anywhere; }
  .candidate p { margin: .2rem 0 0; font-size: .9rem; color: var(--ink-2); }
</style>
