<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { mobileMenuButtonKey } from './mobile-navigation';

  let { children, heading }: { children: Snippet; heading?: Snippet } = $props();
  const menuButton = getContext<Snippet | undefined>(mobileMenuButtonKey);
</script>

{#if menuButton}
  <header class="menu-bar">
    {@render menuButton()}
    {@render heading?.()}
  </header>
{/if}

<main class="page-layout" class:has-mobile-heading={Boolean(menuButton && heading)}>
  {@render children()}
</main>

<style>
  .menu-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    position: sticky;
    top: 0;
    z-index: 20;
    padding: env(safe-area-inset-top) max(0.5rem, env(safe-area-inset-left)) 0;
    background: var(--paper);
    border-bottom: 1px solid var(--rule);
  }
  .menu-bar :global(.page-title) {
    min-width: 0;
    margin: 0;
    padding-block: var(--space-2);
    color: var(--ink);
    font: 600 1.25rem/1.25 var(--font-serif);
    overflow-wrap: anywhere;
  }
  .menu-bar :global(a) { flex-shrink: 0; }
  .menu-bar :global(.subpage-heading) { display: contents; }
  @media (min-width: 960px) {
    .menu-bar { display: none; }
  }
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
  @media (width < 960px) {
    .has-mobile-heading :global(.page-title),
    .has-mobile-heading :global(.subpage-heading),
    .has-mobile-heading :global(header:has(> .page-title:only-child)) { display: none; }
  }
</style>
