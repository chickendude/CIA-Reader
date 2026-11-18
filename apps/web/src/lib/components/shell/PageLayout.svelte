<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="page-layout">
  {@render children()}
</div>

<style>
  .page-layout {
    box-sizing: border-box;
    margin-inline: auto;
    max-width: 88rem;
    padding: clamp(1.25rem, 3vw, 2.25rem) clamp(1rem, 3vw, 2rem) 3.5rem;
    min-width: 0;
    color: var(--ink, var(--color-fg));
  }
  .page-layout :global(.page-title) {
    margin: 0 0 .5rem;
    color: var(--ink, var(--color-fg));
    font-family: var(--font-serif, Georgia, serif);
    font-size: clamp(1.5rem, 2.4vw, 1.9rem);
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -.015em;
    overflow-wrap: anywhere;
  }
  .page-layout :global(.page-form) { max-width: 44rem; }
  .page-layout :global(.page-auth) { max-width: 28rem; }
</style>
