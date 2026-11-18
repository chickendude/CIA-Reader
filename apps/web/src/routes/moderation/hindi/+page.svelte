<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import ContextChoiceButton from '$lib/components/reader/ContextChoiceButton.svelte';
  import type { ServerToken } from '$lib/components/reader/types.js';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let updates = $state(new Map<string, ServerToken>()),
    busy = $state(false),
    message = $state('');
  $effect(() => {
    const update = (event: Event) => {
      const token = (event as CustomEvent<ServerToken>).detail;
      updates = new Map(updates).set(token.id, token);
    };
    window.addEventListener('hindi-context-choice-changed', update);
    return () => window.removeEventListener('hindi-context-choice-changed', update);
  });
  const rows = $derived(
    data.result?.ambiguous.map((row) => ({
      ...row,
      token: updates.get(row.token.id) ?? row.token,
    })) ?? [],
  );
  const queue = $derived(
    rows
      .filter(({ token }) => !token.selectedBy && !token.candidates.some((c) => c.selectedBy))
      .slice(0, 5),
  );
  const limit = $derived(data.kind === 'unparsed' ? 40 : 20);
  function link(kind: string, offset = 0) {
    return `?${new URLSearchParams({ textId: data.result?.book.id ?? '', kind, offset: String(offset), q: data.query })}`;
  }
  async function runAi() {
    busy = true;
    message = '';
    let saved = 0;
    const batch = [...queue];
    try {
      for (const row of batch) {
        message = `Checking ${saved + 1} of ${batch.length}…`;
        const res = await fetch(`/api/v1/tokens/${row.token.id}/hindi-context/ai`, {
          method: 'POST',
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.message ?? 'AI verification failed');
        updates = new Map(updates).set(row.token.id, result.token);
        saved++;
      }
      message = `Saved ${saved} AI suggestions. Confirm the correct entries below.`;
      await invalidateAll();
    } catch (e) {
      message = `${saved} saved. ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Hindi dictionary review | Parhiba</title></svelte:head>
<div class="review-page">
  <a href="/dictionary/hi">← Hindi dictionary</a>
  <h1 class="page-title">Hindi dictionary review</h1>
  <a href="/moderation/hindi/workshop">Open dictionary workshop</a>
  <p>Inspect unparsed words and verify dictionary entries in context.</p>
  <form method="GET" class="filters">
    <label
      >Book <select name="textId" value={data.result?.book.id}
        >{#each data.books as book}<option value={book.id}
            >{book.title}{book.visibility === 'official' ? ' · Official' : ''}</option
          >{/each}</select
      ></label
    >
    <input type="hidden" name="kind" value={data.kind} /><label
      >Word <input name="q" value={data.query} /></label
    ><button>Show</button>
  </form>
  {#if data.result}
    <nav>
      <a class:active={data.kind === 'unparsed'} href={link('unparsed')}>Unparsed words</a><a
        class:active={data.kind === 'ambiguous'}
        href={link('ambiguous')}>Ambiguous occurrences</a
      >
    </nav>
    <p>
      {data.result.total.toLocaleString()}
      {data.kind === 'unparsed' ? 'distinct unparsed words' : 'ambiguous occurrences'}
    </p>
    {#if data.kind === 'unparsed'}
      <table>
        <thead><tr><th>Word</th><th>Occurrences</th><th>Review</th></tr></thead><tbody>
          {#each data.result.unparsed as row}<tr
              ><td>{row.surface}</td><td>{row.frequency}</td><td>
                <a
                  href={`/reader/${data.result.book.id}?chapter=${row.chapterIdx}&token=${row.tokenIdx}`}
                  >Read context</a
                >
                ·
                <a href={`/moderation/hindi/workshop?word=${encodeURIComponent(row.surface)}`}
                  >Find dictionary entry</a
                >
              </td></tr
            >{/each}
        </tbody>
      </table>
    {:else}
      <div class="ai">
        <button
          disabled={busy || !data.aiConfigured || queue.length === 0}
          onclick={() => void runAi()}
          >{busy ? 'Checking…' : `AI check next ${queue.length}`}</button
        >
        <span
          >{data.aiConfigured
            ? `Uses ${data.aiModel}; sends these passages and candidate definitions when clicked.`
            : 'Set OPENAI_API_KEY to enable AI checks.'}</span
        >
      </div>
      {#if message}<p role="status">{message}</p>{/if}
      {#each rows as row (row.token.id)}
        <article>
          <header>
            <strong>{row.token.surface}</strong><span
              >{row.token.selectedBy === 'human'
                ? 'Human confirmed'
                : row.token.selectedBy === 'ai'
                  ? 'AI suggestion'
                  : row.token.selectionStatus === 'needs_review'
                    ? 'Needs review'
                    : 'Unconfirmed'}</span
            ><a
              href={`/reader/${data.result.book.id}?chapter=${row.chapterIdx}&token=${row.token.idx}`}
              >Read context</a
            >
          </header>
          <p class="context">{row.context}</p>
          {#each [{ lemmaId: row.token.lemmaId, headword: row.token.headword ?? row.token.surface, pos: row.token.pos ?? '', glossDefault: row.token.glossDefault, selectedBy: row.token.selectedBy }, ...row.token.candidates] as candidate}
            {#if candidate.lemmaId}<div class="candidate">
                <div>
                  <strong>{candidate.headword}</strong> <small>{candidate.pos}</small>
                  <p>{candidate.glossDefault}</p>
                </div>
                <ContextChoiceButton
                  token={row.token}
                  lemmaId={candidate.lemmaId}
                  label={`${candidate.headword} ${candidate.pos}`}
                  selectedBy={candidate.selectedBy}
                />
              </div>{/if}
          {/each}
        </article>
      {/each}
    {/if}
    <nav>
      {#if data.offset > 0}<a href={link(data.kind, Math.max(0, data.offset - limit))}>← Previous</a
        >{/if}{#if data.offset + limit < data.result.total}<a
          href={link(data.kind, data.offset + limit)}>Next →</a
        >{/if}
    </nav>
  {:else}<p>No Hindi books are available for review.</p>{/if}
</div>

<style>
  p {
    line-height: 1.6;
  }
  .filters,
  nav,
  .ai {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    margin: 1rem 0;
  }
  label {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  input,
  select,
  button {
    font: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1px solid var(--rule);
    border-radius: 5px;
    padding: 0.5rem;
  }
  select {
    max-width: 28rem;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  nav a.active {
    font-weight: 700;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 0.65rem;
    border-bottom: 1px solid var(--rule);
  }
  article {
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
    margin: 1rem 0;
  }
  header {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  header strong {
    font-size: 1.5rem;
  }
  header span,
  .ai span {
    font-size: 0.8rem;
    color: var(--ink-3);
  }
  header a {
    margin-left: auto;
  }
  .context {
    padding: 0.6rem;
    background: var(--card);
    font-size: 1.1rem;
  }
  .candidate {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--rule);
    padding: 0.7rem 0;
  }
  .candidate p {
    margin: 0.3rem 0;
  }
  @media (max-width: 650px) {
    select {
      max-width: 75vw;
    }
    .candidate {
      flex-wrap: wrap;
    }
  }
</style>
