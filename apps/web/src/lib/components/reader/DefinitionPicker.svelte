<script lang="ts">
  import DefinitionMeanings from './DefinitionMeanings.svelte';
  import Sheet from '../overlay/Sheet.svelte';
  import type { ServerToken } from './types.js';

  let { token, language, onPick }: {
    token: ServerToken;
    language?: string;
    onPick: (id: string) => Promise<boolean>;
  } = $props();
  let open = $state(false);
  let saving = $state(false);
  let error = $state('');
  const options = $derived([{
    lemmaId: token.lemmaId, headword: token.headword ?? token.surface,
    pos: token.pos, glossDefault: token.glossDefault,
  }, ...token.candidates]);

  async function select(id: string) {
    if (saving) return;
    saving = true;
    error = '';
    try {
      if (language === 'hi') {
        const response = await fetch(`/api/v1/tokens/${token.id}/hindi-context`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ selectedLemmaIds: [id], expectedVersion: token.contextVersion }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? 'Could not save this definition.');
        window.dispatchEvent(new CustomEvent('hindi-context-choice-changed', { detail: result.token }));
      } else if (!await onPick(id)) {
        throw new Error('Could not save this definition.');
      }
      open = false;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<button class="trigger" type="button" aria-haspopup="dialog"
  onclick={() => { error = ''; open = true; }}>Choose definition</button>
<Sheet {open} onClose={() => open = false} title="Choose definition">
  {#each options as option (option.lemmaId)}
    <button class="choice" type="button" aria-pressed={option.lemmaId === token.lemmaId}
      disabled={saving} onclick={() => option.lemmaId && select(option.lemmaId)}>
      <strong>{option.headword}</strong> <small>{option.pos?.toLowerCase()}</small>
      {#if option.glossDefault}<DefinitionMeanings text={option.glossDefault} />
      {:else}<span>No definition yet.</span>{/if}
    </button>
  {/each}
  {#if error}<p role="alert">{error}</p>{/if}
</Sheet>

<style>
  button { cursor: pointer; color: inherit; font: inherit; background: transparent; }
  .trigger { display: block; margin: 0 0 0.35rem auto; padding: 0.45rem 0.2rem; border: 0; text-decoration: underline; }
  .choice { width: 100%; text-align: left; border: 1px solid var(--rule); border-radius: 7px; margin-bottom: 0.5rem; padding: 0.7rem; line-height: 1.45; }
  .choice[aria-pressed="true"] { border-color: var(--accent); background: color-mix(in oklch, var(--accent) 10%, transparent); }
  .choice span { display: block; }
</style>
