<script lang="ts">
  import { untrack } from 'svelte';
  import EditableDefinition from './EditableDefinition.svelte';
  import ContextChoiceButton from './ContextChoiceButton.svelte';
  import PosPill from './PosPill.svelte';
  import type { ServerCandidate, ServerToken } from './types.js';

  let {
    candidate,
    token,
    textId,
    isOwner,
    onStatusChange,
  }: {
    candidate: ServerCandidate;
    token: ServerToken;
    textId?: string;
    isOwner: boolean;
    onStatusChange?: (id: string, status: ServerToken['status']) => void;
  } = $props();
  let status = $state<ServerToken['status']>(untrack(() => candidate.status ?? 'unknown'));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let frequency = $state<number | null>(null);
  let canonical = $state<{ id: string; body: string } | null>(null);
  let canEdit = $state(false);
  $effect(() => {
    status = candidate.status ?? 'unknown';
  });
  $effect(() => {
    const id = candidate.lemmaId;
    frequency = null;
    canonical = null;
    canEdit = false;
    const controller = new AbortController();
    if (textId)
      void fetch(`/api/v1/texts/${textId}/lemmas/${id}/frequency`, { signal: controller.signal })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            if (!controller.signal.aborted) frequency = data.book;
          }
        })
        .catch(() => {});
    void fetch(`/api/v1/lemmas/${id}/translations`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (controller.signal.aborted) return;
        canEdit = data.canEdit === true;
        canonical =
          data.translations?.official?.find(
            (row: { targetLanguage: string; hidden?: boolean }) =>
              row.targetLanguage === 'en' && !row.hidden,
          ) ?? null;
      })
      .catch(() => {});
    return () => controller.abort();
  });
  async function mark(next: ServerToken['status']) {
    const previous = status;
    const id = candidate.lemmaId;
    status = next;
    saving = true;
    error = null;
    try {
      const res = await fetch(`/api/v1/me/known-lemmas/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: next,
          ...(token.chapterId ? { chapterId: token.chapterId, tokenIdx: token.idx } : {}),
        }),
      });
      if (!res.ok) throw new Error('Could not save study status');
      onStatusChange?.(id, next);
    } catch (e) {
      status = previous;
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<section
  class="candidate-card"
  data-lemma-id={candidate.lemmaId}
  aria-label={`${candidate.headword} ${candidate.pos}`}
>
  <header>
    <span class="headword">{candidate.headword}</span>
    <PosPill pos={candidate.pos} />
    {#if candidate.selectedBy}<small>{candidate.selectedBy === 'ai' ? 'AI selected' : 'Confirmed'}</small>{/if}
    {#if frequency !== null}<span class="frequency" title="Occurrences in this book"
        >{frequency.toLocaleString()}×</span
      >{/if}
  </header>
  <ContextChoiceButton {token} lemmaId={candidate.lemmaId} label={`${candidate.headword} ${candidate.pos}`} selectedBy={candidate.selectedBy} />
  {#if canonical && canEdit}
    <EditableDefinition
      text={canonical.body}
      translationId={canonical.id}
      lemmaId={candidate.lemmaId}
      {canEdit}
      onSave={(body) => {
        if (canonical) canonical = { ...canonical, body };
      }}
    />
  {:else if candidate.personalGloss || canonical?.body || candidate.glossDefault}
    <div>{candidate.personalGloss || canonical?.body || candidate.glossDefault || ''}</div>
  {:else}<p class="empty">No translations</p>{/if}
  {#if isOwner}
    <div
      class="statuses"
      role="group"
      aria-label={`Study status for ${candidate.headword} ${candidate.pos}`}
    >
      {#each [{ value: 'unknown', label: 'Unseen' }, { value: 'learning', label: 'Learning' }, { value: 'known', label: 'Known' }, { value: 'ignored', label: 'Ignored' }] as option}
        <button
          type="button"
          aria-pressed={status === option.value}
          disabled={saving}
          onclick={() => mark(option.value as ServerToken['status'])}>{option.label}</button
        >
      {/each}
    </div>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if canEdit}<a class="edit" href={`/moderation/dictionary/${candidate.lemmaId}`}>Edit forms</a
    >{/if}
</section>

<style>
  .candidate-card {
    border-top: 1px solid var(--rule, var(--color-border));
    padding: 1rem 0;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.65rem;
  }
  .headword {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.5rem;
    margin-right: auto;
  }
  .frequency,
  .empty {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.8rem;
  }
  .statuses {
    display: flex;
    gap: 0.25rem;
    margin-top: 0.8rem;
  }
  button {
    flex: 1;
    padding: 0.45rem 0.25rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
  }
  button[aria-pressed='true'] {
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
  }
  .edit {
    display: inline-block;
    margin-top: 0.6rem;
    font-size: 0.75rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
</style>
