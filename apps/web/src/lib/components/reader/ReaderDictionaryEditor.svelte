<script lang="ts">
  import { onMount } from 'svelte';
  import WorkshopEditor from '$lib/components/dictionary/WorkshopEditor.svelte';
  import Sheet from '$lib/components/overlay/Sheet.svelte';
  import { blankWorkshopWord, type Draft, type WorkshopWord } from '$lib/dictionary/hindi-workshop';
  import { workshop } from '$lib/dictionary/workshop-client';
  import { wordContext } from '$lib/dictionary/word-context';
  import type { ServerToken } from './types';

  let {
    token,
    chapterTokens,
    lemmaId,
    headword,
    ai,
    onClose,
    onSaved,
  }: {
    token: ServerToken;
    chapterTokens?: ServerToken[] | null;
    lemmaId: string | null;
    headword: string;
    ai: boolean;
    onClose: () => void;
    onSaved: (word: WorkshopWord) => void;
  } = $props();

  let word = $state<WorkshopWord>();
  let draft = $state<Draft>();
  let working = $state(false);
  let loading = $state(false);
  let error = $state('');
  let request: AbortController | undefined;
  const context = $derived(wordContext(chapterTokens ?? [], token.idx));

  async function open(id: string | null, lemma: string, pos: string, attach = '') {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    loading = true;
    error = '';
    try {
      const next = id
        ? await workshop<WorkshopWord>('word', { id }, controller.signal)
        : blankWorkshopWord(lemma, pos);
      if (controller.signal.aborted) return;
      const edit = structuredClone(next.draft);
      if (attach) {
        edit.other = [...new Set([...edit.other, attach])];
        edit.excluded = edit.excluded.filter((form) => form !== attach);
      }
      word = next;
      draft = edit;
    } catch (e) {
      if (!controller.signal.aborted) error = (e as Error).message;
    } finally {
      if (!controller.signal.aborted) loading = false;
    }
  }

  onMount(() => {
    void open(lemmaId, headword, 'NOUN', lemmaId ? '' : token.surface);
    return () => request?.abort();
  });
</script>

<Sheet
  open
  onClose={() => {
    if (!working) onClose();
  }}
  title="Hindi dictionary entry"
  width={660}
  maxHeight="94dvh"
>
  {#if loading}
    <p role="status">Loading entry…</p>
  {:else if word && draft}
    {#key word}
      <WorkshopEditor
        {word}
        bind:draft
        bind:working
        {ai}
        observed={token.surface}
        {context}
        review={false}
        onopen={open}
        onsaved={onSaved}
      />
    {/key}
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</Sheet>
