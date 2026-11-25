<script lang="ts">
  import { getToastStore } from '$lib/components/toast/toast-store.js';
  import { workshop } from '$lib/dictionary/workshop-client';
  import type { ReportOption, WorkshopReport } from '$lib/dictionary/workshop';
  import type { LanguageCode } from '@ciareader/shared-types';
  import { untrack } from 'svelte';

  const { pushToast } = getToastStore();
  let {
    language,
    reports,
    open,
    changed,
  }: {
    language: LanguageCode;
    reports: ReportOption[];
    open: (id: string) => void;
    changed: () => void;
  } = $props();
  let name = $state(untrack(() => reports[0]?.name ?? '')),
    filter = $state(''),
    report = $state<WorkshopReport | null>(null);
  let selected = $state<string[]>([]),
    message = $state(''),
    busy = $state(false);
  const verb = $derived(
    reports.find((r) => r.name === name)?.action === 'merge' ? 'Merge' : 'Delete',
  );
  const rows = $derived(report?.rows.filter((r) => !filter || r.state === filter) ?? []);
  const eligible = $derived(rows.flatMap((r) => (r.state === 'ready' && r.id ? [r.id] : [])));
  function reset() {
    report = null;
    selected = [];
    filter = '';
    message = '';
  }
  async function preview() {
    busy = true;
    reset();
    try {
      report = await workshop<WorkshopReport>('report', { report: name }, undefined, language);
    } catch (e) {
      message = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function apply() {
    if (!report || !selected.length) return;
    if (!confirm(verb + ' ' + selected.length + ' selected dictionary entries?')) return;
    busy = true;
    try {
      const { count } = await workshop<{ count: number }>(
        'applyReport',
        {
          report: name,
          ids: selected,
          fingerprint: report.fingerprint,
        },
        undefined,
        language,
      );
      changed();
      pushToast({ kind: 'success', message: count + (count === 1 ? ' entry updated.' : ' entries updated.') });
      await preview();
    } catch (e) {
      message = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<details class="reports">
  <summary>Recommendations and spelling merges</summary>
  <fieldset disabled={busy}>
    <label
      >Report <select bind:value={name} onchange={reset}
        >{#each reports as r}<option value={r.name}>{r.label}</option>{/each}</select
      ></label
    >
    <button onclick={preview}>Preview</button>
    {#if report}<label
        >Show <select bind:value={filter}
          ><option value="">All entries</option
          >{#each [...new Set(report.rows.map((r) => r.state))] as state}<option value={state}
              >{state.replaceAll('_', ' ')}</option
            >{/each}</select
        ></label
      >
      <p>{rows.length} entries, {eligible.length} eligible.</p>
      {#if eligible.length}<button
          onclick={() => (selected = [...new Set([...selected, ...eligible])])}
          >Select eligible entries</button
        ><button onclick={() => (selected = [])}>Clear selection</button>{/if}
      <div class="rows">
        {#each rows as row}<div class="row">
            {#if row.state === 'ready' && row.id}<input
                aria-label={'Select ' + row.lemma}
                type="checkbox"
                value={row.id}
                bind:group={selected}
              />{/if}
            {#if row.id}<button onclick={() => open(row.id!)}>{row.lemma}</button
              >{:else}{row.lemma}{/if} <small>{row.pos} {row.state.replaceAll('_', ' ')}</small>
            {#if row.target_lemma}
              → {row.target_lemma}{/if}
            <p>{row.recommendation ?? ''} {row.reason} {row.blocked ?? ''}</p>
          </div>{/each}
      </div>
      {#if selected.length}<button onclick={apply}>{verb} {selected.length} selected entries</button
        >{/if}{/if}
  </fieldset>
  {#if busy || message}<p role="status">{busy ? 'Loading…' : message}</p>{/if}
</details>

<style>
  .reports {
    margin: 0.5rem 0 1rem;
  }
  summary {
    cursor: pointer;
  }
  fieldset {
    border: 1px solid var(--rule);
    border-radius: 0.5rem;
    margin: 0.5rem 0;
    padding: 0.75rem;
  }
  button,
  select {
    font: inherit;
    background: var(--paper);
    color: inherit;
    border: 1px solid var(--rule);
    border-radius: 0.35rem;
    padding: 0.3rem 0.5rem;
    margin: 0.15rem;
  }
  .rows {
    max-height: 17rem;
    overflow: auto;
  }
  .row {
    padding: 0.4rem;
    border-bottom: 1px solid var(--rule);
  }
  .row p {
    margin: 0.2rem 0;
    font-size: 0.87rem;
  }
</style>
