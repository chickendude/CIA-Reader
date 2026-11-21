<script lang="ts">
  import Button from '$lib/components/input/Button.svelte';
  import type { HindiMerge } from '$lib/dictionary/hindi-merge';

  let {
    chapterId,
    options = [],
    confirmed,
    onSaved,
  }: {
    chapterId: string;
    options?: HindiMerge[];
    confirmed?: HindiMerge;
    onSaved: () => void | Promise<void>;
  } = $props();
  let saving = $state(false);
  let message = $state('');

  async function save(option: HindiMerge, method: 'POST' | 'DELETE') {
    if (saving) return;
    saving = true;
    message = '';
    try {
      const res = await fetch(`/api/v1/chapters/${chapterId}/hindi-merge`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(option),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Could not save this change.');
      await onSaved();
    } catch (e) {
      message = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

{#if confirmed}
  <Button disabled={saving} onclick={() => confirmed && save(confirmed, 'DELETE')}
    >Undo merge</Button
  >
{/if}
{#each options as option}
  <Button disabled={saving} onclick={() => save(option, 'POST')}>
    Merge as <span lang="hi">{option.headword}</span>
    {#if options.some((other) => other.lemmaId !== option.lemmaId && other.headword === option.headword)}
      ({option.pos})
    {/if}
  </Button>
{/each}
{#if message}<p role="alert">{message}</p>{/if}
