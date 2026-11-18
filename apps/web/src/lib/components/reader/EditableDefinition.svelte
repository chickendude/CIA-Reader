<script lang="ts">
  import { tick, untrack } from 'svelte';

  let {
    text,
    translationId,
    lemmaId,
    canEdit = false,
    onSave,
  }: {
    text: string;
    translationId: string;
    lemmaId: string;
    canEdit?: boolean;
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
  let textarea: HTMLTextAreaElement | null = $state(null);
  async function edit() {
    if (editing || saving) return;
    draft = body;
    error = null;
    editing = true;
    await tick();
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }
  function cancel() { editing = false; error = null; }
  async function save() {
    if (!editing || saving) return;
    const value = draft
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('; ');
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
  {#if canEdit}
    <div class="editor-box">
      <div class="editable" class:concealed={editing} role="button" tabindex="0"
        aria-label="Edit definition" title="Click to edit definition"
        onclick={() => void edit()}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void edit(); }
        }}>{body}</div>
      {#if editing}
        <textarea bind:this={textarea} bind:value={draft} aria-label="Edit definition"
          readonly={saving} onblur={() => void save()}
          onkeydown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
            else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void save(); }
          }}></textarea>
      {/if}
    </div>
  {:else}<div class="definition-text">{body}</div>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .definition-editor { width: 100%; }
  .editor-box { position: relative; }
  .editable, textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 2em;
    padding: 0.2rem;
    border: 1px solid transparent;
    border-radius: 5px;
    font: inherit;
    line-height: inherit;
    color: inherit;
  }
  .editable { cursor: text; white-space: pre-wrap; overflow-wrap: anywhere; }
  .editable:hover, .editable:focus-visible { border-color: var(--rule, var(--color-border)); border-style: dashed; outline: none; }
  .concealed { visibility: hidden; }
  textarea {
    position: absolute; inset: 0; height: 100%; resize: none; margin: 0;
    background: var(--card, var(--color-bg)); border-color: var(--rule, var(--color-border));
    outline: none; overflow: auto;
  }
  .error { color: var(--color-danger, #c33); font-size: 0.8rem; }
</style>
