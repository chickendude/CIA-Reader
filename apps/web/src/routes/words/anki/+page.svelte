<script lang="ts">
  import PageLayout from '$lib/components/shell/PageLayout.svelte';
  import PageTitle from '$lib/components/shell/PageTitle.svelte';
  import Button from '$lib/components/input/Button.svelte';
  import TextField from '$lib/components/input/TextField.svelte';
  import { ankiConnect, rememberAnkiConnection } from '$lib/anki-connect';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  type Card = {
    word: string;
    pos: string;
    definition: string;
    frequency: number;
    minedSentence: string | null;
    samples: string[];
  };

  const defaultDeckName = $derived(data.mode === 'export' ? data.deckName : 'CIA Reader');
  let deckName = $derived(defaultDeckName);
  let sending = $state(false);
  let sendMsg = $state<string | null>(null);
  let sendErr = $state<string | null>(null);

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function backHtml(card: Card): string {
    const parts: string[] = [];
    if (card.definition) parts.push(`<div>${escapeHtml(card.definition)}</div>`);
    const sentences = [
      ...(card.minedSentence ? [card.minedSentence] : []),
      ...card.samples,
    ];
    for (const s of sentences) parts.push(`<div>${escapeHtml(s)}</div>`);
    return parts.join('');
  }

  async function sendToAnki(): Promise<void> {
    if (data.mode !== 'export') return;
    sending = true;
    sendMsg = null;
    sendErr = null;
    try {
      await ankiConnect('createDeck', { deck: deckName });
      rememberAnkiConnection();
      const notes = data.cards.map((c) => ({
        deckName,
        modelName: 'Basic',
        fields: { Front: c.word, Back: backHtml(c) },
        options: { allowDuplicate: false },
        tags: ['ciareader', data.language],
      }));
      const result = (await ankiConnect('addNotes', { notes })) as Array<number | null>;
      const added = Array.isArray(result) ? result.filter((x) => x != null).length : 0;
      sendMsg = `Added ${added} of ${notes.length} cards to "${deckName}". Duplicates are skipped.`;
    } catch (e) {
      sendErr =
        `Couldn't reach Anki (${(e as Error).message}). Make sure Anki is open with the ` +
        `AnkiConnect add-on, and that ${location.origin} is listed in AnkiConnect's ` +
        `webCorsOriginList setting.`;
    } finally {
      sending = false;
    }
  }

  const downloadHref = $derived(
    data.mode === 'export'
      ? `/api/v1/me/anki/export?textId=${encodeURIComponent(data.textId)}&deck=${encodeURIComponent(deckName)}${data.includeStudied ? '&includeStudied=1' : ''}`
      : '#',
  );
</script>

<svelte:head><title>Export to Anki | Parhiba</title></svelte:head>

{#snippet heading()}
  <PageTitle>Export to Anki</PageTitle>
{/snippet}

<PageLayout {heading}>
<section class="anki page-form">
  {@render heading()}
  <a href="/words/anki/import">Import vocabulary from Anki Desktop</a>

  {#if data.mode === 'pick'}
    <p class="muted">Choose a book to export its vocabulary.</p>
    {#if data.texts.length === 0}
      <p class="muted">You haven't uploaded any texts yet.</p>
    {:else}
      <ul class="books">
        {#each data.texts as t (t.id)}
          <li>
            <a href={`/words/anki?textId=${t.id}`}>
              {t.title}
              <span class="muted">({t.language})</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <form method="GET" data-sveltekit-keepfocus data-sveltekit-noscroll
      onsubmit={() => { sendMsg = null; sendErr = null; }}>
      <input type="hidden" name="textId" value={data.textId} />
      <Button type="submit" variant="toggle" name="includeStudied" value={data.includeStudied ? '0' : '1'}
        aria-pressed={data.includeStudied} disabled={sending}>Include known and learning words</Button>
    </form>

    <p class="muted" aria-live="polite">
      <strong>{data.title}</strong> has {data.cards.length} {data.cards.length === 1 ? 'card' : 'cards'}
      to export, most frequent first.
    </p>

    <label class="deck">
      <span>Deck name</span>
      <TextField bind:value={deckName} aria-label="Deck name" />
    </label>

    <div class="actions">
      <Button
        disabled={data.cards.length === 0}
        href={downloadHref}
        download
      >
        Download .apkg
      </Button>
      <Button
        variant="primary"
        onclick={sendToAnki}
        disabled={sending || data.cards.length === 0}
      >
        {sending ? 'Sending…' : 'Send to Anki'}
      </Button>
    </div>

    {#if sendMsg}<p class="ok" role="status">{sendMsg}</p>{/if}
    {#if sendErr}<p class="err" role="alert">{sendErr}</p>{/if}

    {#if data.cards.length === 0}
      <p class="muted">
        {data.includeStudied ? 'No words are available to export from this book.' : 'No unseen words are available to export from this book.'}
      </p>
    {:else}
      <ul class="cards">
        {#each data.cards as c (c.id)}
          <li class="card">
            <div class="card-head">
              <span class="word">{c.word}</span>
              {#if c.frequency > 0}<span class="freq">{c.frequency}×</span>{/if}
            </div>
            {#if c.definition}<div class="def">{c.definition}</div>{/if}
            {#if c.minedSentence}<div class="sent">{c.minedSentence}</div>{/if}
            {#each c.samples as s (s)}<div class="sent sample">{s}</div>{/each}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
</PageLayout>

<style>
  .muted {
    color: var(--color-fg-muted);
  }
  .books {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .books a {
    color: var(--color-fg);
    text-decoration: underline;
  }
  .deck {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 1rem 0;
    max-width: 24rem;
    font-size: 0.85rem;
    color: var(--color-fg-muted);
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .ok {
    color: var(--color-fg);
  }
  .err {
    color: #b91c1c;
  }
  .cards {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .card {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .word {
    font-weight: 600;
    font-size: 1.05rem;
  }
  .freq {
    font-size: 0.78rem;
    color: var(--color-fg-muted);
  }
  .def {
    margin-top: 0.15rem;
  }
  .sent {
    margin-top: 0.3rem;
    font-size: 0.85rem;
    color: var(--color-fg-muted);
    font-style: italic;
  }
</style>
