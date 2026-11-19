<script lang="ts">
  import Button from '$lib/components/input/Button.svelte';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import SubpageHeading from '$lib/components/shell/SubpageHeading.svelte';
  import SegmentedControl from '$lib/components/input/SegmentedControl.svelte';
  import DeckPicker from './DeckPicker.svelte';
  import {
    ankiConnect,
    hasConnectedToAnki,
    rememberAnkiConnection,
    collectEntries,
    readDecks,
    assignments,
    cardTypes,
    defaultMapping,
    readMapping,
    type Assignment,
    type CardMapping,
    type CardType,
  } from '$lib/anki-connect';
  const statusOptions = assignments.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }));
  let { data }: { data: PageData } = $props();
  let decks = $state<string[]>([]),
    chosen = $state<string[]>([]);
  let mapping = $state<CardMapping>({ ...defaultMapping });
  const preferenceKey = $derived(`parhiba.anki.cardMapping.${data.user?.id}`);
  $effect(() => {
    const key = preferenceKey;
    try {
      mapping = readMapping(localStorage.getItem(key));
    } catch {
      mapping = { ...defaultMapping };
    }
  });

  const deckKey = $derived(`parhiba.anki.decks.${data.user?.id}`);

  function restoreDecks(available: string[]) {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(deckKey) ?? '[]');
      if (Array.isArray(saved)) return available.filter((name) => saved.includes(name));
    } catch {
      // Keep the current selection when storage is unavailable.
    }
    return chosen.filter((name) => available.includes(name));
  }

  function selectDecks(next: string[]) {
    chosen = next;
    reset();
    try {
      localStorage.setItem(deckKey, JSON.stringify(next));
    } catch {
      message = 'Your browser could not save the selected decks for next time.';
    }
  }

  function setAssignment(type: CardType, assignment: Assignment) {
    mapping = { ...mapping, [type]: assignment };
    reset();
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(mapping));
    } catch {
      message = 'Your browser could not save these choices for next time.';
    }
  }

  let connecting = $state(false);
  let connected = $state(false);
  let importing = $state(false);
  const busy = $derived(connecting || importing);
  let message = $state('');
  let preview = $state<{
    matched: number;
    changes: number;
    unmatchedEntries: { headword: string | null; parhibaId: string | null }[];
    counts: Record<string, number>;
  } | null>(null);
  let batch = $state<ReturnType<typeof collectEntries> | null>(null);
  let imported = $state(false);
  function reset() {
    preview = null;
    batch = null;
    imported = false;
    message = '';
  }
  onMount(() => {
    if (hasConnectedToAnki()) void connect(true);
  });

  async function connect(automatic = false) {
    if (busy) return;
    reset();
    connecting = true;
    try {
      if (!automatic) {
        const { permission } = await ankiConnect<{ permission: string }>('requestPermission');
        if (permission !== 'granted') throw new Error('AnkiConnect permission was declined');
      }
      decks = await ankiConnect<string[]>(
        'deckNames',
        {},
        automatic ? AbortSignal.timeout(5000) : undefined,
      );
      connected = true;
      rememberAnkiConnection();
      chosen = restoreDecks(decks);
      if (!decks.length) message = 'No decks found.';
    } catch (e) {
      connected = false;
      decks = [];
      if (automatic) {
        message = 'Could not reconnect to Anki Desktop. Open Anki and try again.';
      } else
        message = `${(e as Error).message}. Open Anki Desktop with AnkiConnect and allow ${location.origin} in its webCorsOriginList.`;
    } finally {
      connecting = false;
    }
  }
  async function run(apply: boolean) {
    importing = true;
    message = '';
    try {
      if (!apply) {
        reset();
        batch = collectEntries(await readDecks(chosen), chosen, mapping);
      }
      if (!batch) return;
      const res = await fetch('/api/v1/me/anki/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apply, entries: batch.entries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Import failed');
      preview = data;
      imported = apply;
    } catch (e) {
      message = (e as Error).message;
    } finally {
      importing = false;
    }
  }
</script>

<svelte:head><title>Import Anki vocabulary | Parhiba</title></svelte:head>
<div class="import-page page-form">
  <SubpageHeading title="Import Anki vocabulary" href="/words" closeLabel="Close import and return to vocabulary" />
  <Button disabled={busy} onclick={() => connect()}>
    {connecting ? 'Connecting…' : connected ? 'Refresh decks' : 'Connect to Anki Desktop'}
  </Button>
  {#if decks.length}
    <fieldset disabled={busy}>
      <legend>Decks</legend>
      <DeckPicker {decks} {chosen} onSelect={selectDecks} />
    </fieldset>
  {/if}
  <fieldset class="mapping" disabled={busy}>
    <legend>Card status</legend>
    {#each cardTypes as type (type)}
      {@const label = type.charAt(0).toUpperCase() + type.slice(1)}
      <div class="mapping-row">
        <span>{label}</span>
        <SegmentedControl
          {label}
          options={statusOptions}
          value={mapping[type]}
          onChange={(assignment) => setAssignment(type, assignment)}
        />
      </div>
    {/each}
  </fieldset>
  {#if decks.length}
    <Button
      disabled={busy || !chosen.length || cardTypes.every((type) => mapping[type] === 'ignore')}
      onclick={() => run(false)}>Preview import</Button
    >
  {/if}
  {#if importing}<p role="status">Reading entries…</p>{/if}
  {#if preview && batch}
    <section aria-live="polite">
      <h2>{imported ? 'Import complete' : 'Import preview'}</h2>
      <p>
        {preview.matched} matched dictionary {preview.matched === 1 ? 'entry' : 'entries'}. {preview.changes}
        {imported ? 'changed' : 'would change'}.
      </p>
      <p>
        Learning {preview.counts.learning}, known {preview.counts.known}.
      </p>
      {#if batch.missingWord}<p>{batch.missingWord} cards skipped without an entry ID or headword.</p>{/if}
      {#if preview.unmatchedEntries.length}
        <details>
          <summary
            >{preview.unmatchedEntries.length}
            {preview.unmatchedEntries.length === 1 ? 'entry' : 'entries'} without a dictionary match</summary
          >
          <ul class="unmatched">
            {#each preview.unmatchedEntries as entry}
              <li>
                {#if entry.headword}<span lang="hi">{entry.headword}</span>{/if}
                {#if entry.parhibaId}<code>{entry.parhibaId}</code>{/if}
                {#if !entry.headword && !entry.parhibaId}Missing headword{/if}
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      {#if !imported && preview.changes}<Button variant="primary" disabled={busy} onclick={() => run(true)}
          >Import {preview.changes} changes</Button
        >{/if}
    </section>
  {/if}
  {#if message}<p role="status">{message}</p>{/if}
</div>

<style>
  fieldset,
  section {
    margin: 1rem 0;
    border: 1px solid var(--rule);
    border-radius: 0.6rem;
    padding: 1rem;
  }
  fieldset {
    max-height: 18rem;
    overflow: auto;
  }
  .mapping-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(max-content, 14rem);
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0;
  }
  .mapping-row + .mapping-row {
    border-top: 1px solid var(--rule);
  }
  @media (max-width: 26rem) {
    .mapping-row {
      grid-template-columns: 1fr auto;
    }
  }
  @media (max-width: 22rem) {
    .mapping-row {
      grid-template-columns: 1fr;
    }
  }
  fieldset.mapping {
    max-height: none;
  }
  legend {
    font-weight: 600;
  }
  .unmatched code {
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .unmatched {
    max-height: 12rem;
    overflow: auto;
  }
</style>
