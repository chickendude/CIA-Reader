<!--
  Fixed-position stack that renders every active toast from the
  `toasts` store. Mount this once in the root layout — `pushToast()`
  from anywhere in the app routes through here.
-->
<script lang="ts">
  import { toasts } from './toast-store.js';
  import Toast from './Toast.svelte';
</script>

<div class="toast-host" aria-label="Notifications">
  {#each $toasts as t (t.id)}
    <Toast toast={t} />
  {/each}
</div>

<style>
  /* The host itself is non-blocking; each toast turns pointer-events
     back on for its own clickable surface. That way an empty host
     never intercepts a click on the page underneath. */
  .toast-host {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
  }
  .toast-host > :global(.toast) {
    pointer-events: auto;
  }

  /* On narrow viewports center the toasts horizontally — sitting in
     a corner makes them hard to dismiss with thumb-reach. */
  @media (max-width: 30rem) {
    .toast-host {
      left: 1rem;
      right: 1rem;
      align-items: center;
    }
    .toast-host > :global(.toast) {
      width: 100%;
    }
  }
</style>
