<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

  type Props = ((HTMLAnchorAttributes & { href: string }) | (HTMLButtonAttributes & { href?: never })) & {
    variant?: 'primary' | 'secondary' | 'toggle';
    disabled?: boolean;
    children: Snippet;
  };

  // svelte-ignore custom_element_props_identifier
  let { variant = 'secondary', disabled, children, ...attrs }: Props = $props();
</script>

{#if attrs.href !== undefined}
  <a {...attrs} href={disabled ? undefined : attrs.href} role={disabled ? 'link' : undefined}
    aria-disabled={disabled || undefined} data-variant={variant}>{@render children()}</a>
{:else}
  <button type="button" {...attrs} {disabled} data-variant={variant}>{@render children()}</button>
{/if}

<style>
  a, button {
    --button-bg: var(--card, var(--color-bg));
    --button-border: var(--rule, var(--color-border));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-height: 2.25rem;
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--button-border);
    border-radius: 7px;
    background: var(--button-bg);
    color: var(--ink, var(--color-fg));
    font: 500 0.84rem/1.25 var(--font-sans, var(--font-ui));
    text-decoration: none;
    cursor: pointer;
  }
  [data-variant='primary'] {
    --button-bg: var(--ink, var(--color-fg));
    --button-border: var(--button-bg);
    color: var(--paper, var(--color-bg));
  }
  :global([data-theme='dark']) [data-variant='primary'] {
    --button-bg: var(--ink-2, var(--color-fg-muted));
  }
  [data-variant='toggle'] {
    text-transform: capitalize;
  }
  [aria-pressed='true'], [aria-pressed='mixed'] {
    --button-border: var(--ink-3, var(--color-border-strong));
  }
  [aria-pressed='true'] {
    --button-bg: var(--accent-soft, var(--color-surface-2));
  }
  @media (hover: hover) {
    :is(a, button):hover:not(:disabled, [aria-disabled='true']) {
      border-color: color-mix(in oklch, var(--button-border) 88%, currentColor);
      background: color-mix(in oklch, var(--button-bg) 95%, currentColor);
    }
  }
  :is(a, button):focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 2px;
  }
  button:disabled, [aria-disabled='true'] {
    opacity: 0.55;
    cursor: default;
  }
</style>
