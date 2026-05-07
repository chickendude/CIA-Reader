<!--
  Compact morphology-feature badge with a hover/focus tooltip
  expanding the abbreviation into the full UD label. Used as a row
  next to the headword in WordPopup so a learner clicking on `ରହିଲି`
  sees pills like `past 1 sg` whose hover reveals "past tense" /
  "first person" / "singular". Mirrors PosPill.svelte's visual
  treatment so the popup header reads as one consistent strip.
-->
<script lang="ts">
  interface Props {
    short: string;
    long: string;
    /** UD feature key — emitted as a `data-feat-key` attribute so
     *  integration tests can target a specific pill. */
    featKey: string;
    /** Optional class hook so callers can place pills in flex rows
     *  without piling extra spans on top. */
    class?: string;
  }
  let { short, long, featKey, class: extraClass = '' }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<span
  class="feat-pill {extraClass}"
  data-feat-key={featKey}
  data-testid="feat-pill"
  tabindex="0"
  aria-label={long}
>
  <span class="feat-abbr">{short}</span>
  <span class="feat-pop" role="tooltip">{long}</span>
</span>

<style>
  .feat-pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.4rem;
    height: 1.1rem;
    padding: 0 0.4rem;
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 4%,
      transparent
    );
    color: var(--ink-2, var(--color-fg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
    font-family: var(--font-mono-display, var(--font-mono, monospace));
    font-size: 0.65rem;
    line-height: 1;
    text-transform: lowercase;
    letter-spacing: 0.02em;
    cursor: help;
  }
  .feat-pill:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 2px;
  }
  .feat-abbr {
    font-weight: 500;
  }
  .feat-pop {
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
  .feat-pop::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-top-color: var(--ink, #1f1a14);
  }
  .feat-pill:hover .feat-pop,
  .feat-pill:focus-visible .feat-pop,
  .feat-pill:focus .feat-pop {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .feat-pop {
      transition: none;
    }
  }
</style>
