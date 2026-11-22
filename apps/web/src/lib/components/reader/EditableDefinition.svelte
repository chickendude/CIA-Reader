<script lang="ts">
  import { serializeMeanings } from '$lib/dictionary/meanings';
  import { untrack } from 'svelte';
  import MeaningInput from '$lib/components/input/MeaningInput.svelte';
  import DefinitionMeanings from './DefinitionMeanings.svelte';

  let {
    text,
    translationId,
    lemmaId,
    canEdit = false,
    sheet = false,
    onSave,
  }: {
    text: string;
    translationId: string;
    lemmaId: string;
    canEdit?: boolean;
    sheet?: boolean;
    onSave?: (body: string) => void;
  } = $props();
  let body = $state(untrack(() => text));
  let draft = $state('');
  let editing = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  $effect(() => {
    body = text;
    editing = false;
  });
  function edit() {
    if (editing || saving) return;
    draft = body;
    error = null;
    editing = true;
  }
  function cancel() { editing = false; error = null; }
  async function save() {
    if (!editing || saving) return;
    const value = serializeMeanings(draft);
    if (!value) {
      error = 'Enter at least one meaning.';
      return;
    }
    if (value === body) { editing = false; return; }
    saving = true;
    error = null;
    try {
      const res = await fetch(`/api/v1/admin/translations/${translationId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: value, reason: 'Edited dictionary definition' }),
      });
      if (!res.ok)
        throw new Error(
          res.status === 403
            ? 'You do not have permission to edit this dictionary.'
            : 'Could not save the definition.',
        );
      body = value;
      editing = false;
      onSave?.(value);
      window.dispatchEvent(
        new window.CustomEvent('dictionary-definition-changed', { detail: { lemmaId, body: value } }),
      );
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="definition-editor">
  {#if editing}
    <MeaningInput bind:value={draft} label="Edit definition" {sheet} focusOnMount
      disabled={saving} onsave={save} onblur={save} oncancel={cancel} />
  {:else if canEdit}
    <div class="editable" role="button" tabindex="0" aria-label="Edit definition"
      title="Click to edit definition" onclick={edit}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); }
      }}>
      <DefinitionMeanings text={body} />
    </div>
  {:else}
    <DefinitionMeanings text={body} />
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .definition-editor { width: 100%; min-width: 0; }
  .editable { cursor: text; padding: 0.2rem; border: 1px solid transparent; border-radius: 5px; }
  .editable:hover, .editable:focus-visible { border-color: var(--rule, var(--color-border)); border-style: dashed; outline: none; }
  .error { color: var(--color-danger, #c33); font-size: 0.8rem; }
</style>
