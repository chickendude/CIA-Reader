<!--
  Hover tooltip (T-5.10).

  Lightweight read-only popover that follows the cursor on word
  hover. Shows the surface form, romanization (when present), and
  the lemma's gloss/definition if it's already on the token row. No
  fetch — this surface stays cheap so hovering through a paragraph
  doesn't trigger N network calls. Click on the same word opens the
  full side panel (WordPopup), which does fetch.
-->
<script lang="ts">
  import type { ServerToken } from './types.js';
  import { placeTooltip, type AnchorRect } from './tooltip-position.js';

  interface Props {
    token: ServerToken;
    anchorRect: AnchorRect;
  }

  let { token, anchorRect }: Props = $props();

  let tipEl: HTMLDivElement | null = $state(null);
  let measured = $state<{ w: number; h: number } | null>(null);

  // Placement is derived from the anchor + measured dimensions so it
  // re-runs whenever the parent rebinds the tooltip to a new word.
  // Defaults seed the first paint near the word; the $effect below
  // refines once we measure for real.
  const placement = $derived.by(() => {
    const w = measured?.w ?? 240;
    const h = measured?.h ?? 80;
    return placeTooltip(anchorRect, w, h, {
      width: typeof window !== 'undefined' ? window.innerWidth : 1024,
      height: typeof window !== 'undefined' ? window.innerHeight : 768,
    });
  });

  $effect(() => {
    if (!tipEl) return;
    measured = {
      w: tipEl.offsetWidth || 240,
      h: tipEl.offsetHeight || 80,
    };
  });
</script>

<div
  bind:this={tipEl}
  class="tip"
  role="tooltip"
  aria-hidden="false"
  style:top="{placement.top}px"
  style:left="{placement.left}px"
>
  <div class="tip-head">
    <span class="tip-w">{token.surface}</span>
    {#if token.romanization}
      <span class="tip-roman">{token.romanization}</span>
    {/if}
  </div>
  <!-- T-5.20: surface the top translation when we have one, fall
       back to an italic "No translations" otherwise so the user
       always knows whether the lookup is empty or just absent. The
       tooltip stays no-fetch — it reads `glossDefault` off the token
       row, which the side-panel still backs up with the full
       hierarchy on click. -->
  {#if token.isOov}
    <div class="tip-def empty">No dictionary match</div>
  {:else if token.glossDefault}
    <div class="tip-def">{token.glossDefault}</div>
  {:else}
    <div class="tip-def empty">No translations</div>
  {/if}
</div>

<style>
  .tip {
    position: fixed;
    z-index: 30;
    background: var(--ink, #1f1a14);
    color: var(--paper, #fdfaf3);
    border-radius: 8px;
    padding: 0.55rem 0.75rem;
    font-size: 0.78rem;
    font-family: var(--font-sans, system-ui, sans-serif);
    max-width: 280px;
    pointer-events: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
    line-height: 1.4;
    animation: fade-in 120ms ease-out;
  }
  .tip-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
    flex-wrap: wrap;
  }
  .tip-w {
    font-family: var(--font-serif-dev, var(--font-serif, serif));
    font-size: 1rem;
    line-height: 1.1;
  }
  .tip-roman {
    font-family: var(--font-mono-display, var(--font-mono, monospace));
    font-size: 0.7rem;
    color: color-mix(in oklch, var(--paper, #fdfaf3) 70%, transparent);
    flex-shrink: 0;
  }
  .tip-def {
    color: color-mix(in oklch, var(--paper, #fdfaf3) 88%, transparent);
    font-size: 0.78rem;
    line-height: 1.35;
    /* Long glosses (e.g. multi-meaning lemmas) get clamped to two
     * lines — the side panel still shows the full text on click. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  /* T-5.20: italic "no match" / "no translations" copy. */
  .tip-def.empty {
    color: color-mix(in oklch, var(--paper, #fdfaf3) 65%, transparent);
    font-style: italic;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tip {
      animation: none;
    }
  }
</style>
