<script lang="ts">
  import type { PageData } from './$types';
  let { patterns, current }: { patterns: PageData['hindiPatterns']; current: string } = $props();
  let selection = $state<string>();
  const active = $derived(patterns.find((pattern) => pattern.id === (selection ?? current)));
</script>

<fieldset>
  <legend>Inflection pattern</legend>
  <div class="patterns">
    {#each patterns as pattern}
      <label>
        <input
          type="radio"
          name="paradigm"
          value={pattern.id}
          checked={active?.id === pattern.id}
          onchange={() => (selection = pattern.id)}
        />
        {pattern.label}
      </label>
    {/each}
  </div>
</fieldset>
{#if active && active.id !== 'invariant'}
  {#if active.forms}
    <p><strong>Generated spellings</strong> <span lang="hi">{active.forms.join(', ')}</span></p>
    {#if active.slots.length}
      <details>
        <summary>Forms by grammatical slot</summary>
        <dl>
          {#each active.slots as slot}<dt>{slot.label}</dt>
            <dd lang="hi">{slot.forms.join(', ')}</dd>{/each}
        </dl>
      </details>
    {/if}
  {:else}
    <p role="status">The parser could not preview this pattern.</p>
  {/if}
{/if}

<style>
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend,
  strong {
    font-weight: 600;
  }
  .patterns {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.6rem 0;
  }
  label {
    border: 1px solid var(--rule);
    border-radius: 0.4rem;
    padding: 0.45rem 0.65rem;
    cursor: pointer;
  }
  label:has(:checked) {
    border-color: var(--accent);
  }
  input {
    accent-color: var(--accent);
  }
  dl {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.4rem;
  }
  dd {
    margin: 0;
  }
</style>
