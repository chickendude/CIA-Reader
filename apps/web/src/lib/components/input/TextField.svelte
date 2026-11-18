<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  type Props = Omit<HTMLInputAttributes, 'type' | 'value'> & { type?: 'text' | 'search'; value?: string };
  // svelte-ignore custom_element_props_identifier
  let { type = 'text', value = $bindable(''), ...attrs }: Props = $props();
</script>

<input {...attrs} {type} bind:value />

<style>
  input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    min-height: 2.25rem;
    padding: 0.4rem 0.65rem;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 7px;
    font: inherit;
  }
  @media (hover: hover) {
    input:hover:not(:disabled) {
      border-color: var(--ink-3, var(--color-border-strong));
    }
  }
  input:focus {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 1px;
  }
</style>
