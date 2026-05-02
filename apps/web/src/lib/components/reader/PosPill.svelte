<!--
  Compact part-of-speech badge with a hover/focus popover that
  expands the abbreviation into a full Universal-Dependencies name.
  Replaces the plain "Part of speech: NOUN" line in the WordPopup
  header and the inline POS tag in the alt-candidate list, where the
  raw UD tag spelt out long was visually heavy.
-->
<script lang="ts">
  import { posAbbr, posFullName } from './pos-labels.js';

  interface Props {
    pos: string;
    /** Optional class hook so callers can place the pill in flex
     *  rows without piling extra spans on top of it. */
    class?: string;
  }

  let { pos, class: extraClass = '' }: Props = $props();

  const abbr = $derived(posAbbr(pos));
  const fullName = $derived(posFullName(pos));
</script>

<!-- A non-interactive POS chip that still surfaces a tooltip on
     focus + hover. role="button" is overkill (it doesn't trigger
     anything), but tabindex on a bare span trips an a11y warning
     unless we mark it as something the keyboard can land on. -->
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.6rem;
    height: 1.25rem;
    padding: 0 0.45rem;
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 6%,
      transparent
    );
    color: var(--ink-2, var(--color-fg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
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
    font-weight: 600;
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
