<!--
  Part-of-speech abbreviation with the full name on hover or keyboard focus.
-->
<script lang="ts">
  import { posAbbr, posFullName } from './pos-labels.js';

  interface Props {
    pos: string;
    class?: string;
  }

  let { pos, class: extraClass = '' }: Props = $props();

  const abbr = $derived(posAbbr(pos));
  const fullName = $derived(posFullName(pos));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<span
  class="pos-pill {extraClass}"
  data-pos={pos}
  data-testid="pos-pill"
  tabindex="0"
  aria-label={fullName}
>
  <span class="pos-abbr">{abbr}</span>
  <span class="pos-pop" role="tooltip">{fullName}</span>
</span>

<style>
  .pos-pill {
    position: relative;
    display: inline-block;
    font-family: var(--font-mono-display, var(--font-mono, monospace));
    font-size: 0.7rem;
    line-height: 1;
    text-transform: lowercase;
    letter-spacing: 0.02em;
    cursor: help;
  }
  .pos-pill:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 2px;
  }
  .pos-abbr {
    font-weight: 400;
    color: color-mix(in srgb, currentColor 65%, transparent);
  }
  .pos-pop {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 0.3rem 0.55rem;
    background: var(--ink, #1f1a14);
    color: var(--paper, #fdfaf3);
    border-radius: 6px;
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.7rem;
    line-height: 1.2;
    white-space: nowrap;
    text-transform: none;
    letter-spacing: 0;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    opacity: 0;
    pointer-events: none;
    transition: opacity 100ms ease-out;
    z-index: 60;
  }
  .pos-pop::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-top-color: var(--ink, #1f1a14);
  }
  .pos-pill:hover .pos-pop,
  .pos-pill:focus-visible .pos-pop,
  .pos-pill:focus .pos-pop {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .pos-pop {
      transition: none;
    }
  }
</style>
