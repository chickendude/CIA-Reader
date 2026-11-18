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
  import DefinitionMeanings from './DefinitionMeanings.svelte';
  import PosPill from './PosPill.svelte';
  import type { LanguageCode } from '@ciareader/shared-types';
  import {
    looksLikeNumberToken,
    type ServerToken,
    type ServerNumberLanguageForm,
  } from './types.js';
  import { placeTooltip, type AnchorRect } from './tooltip-position.js';

  interface Props {
    token: ServerToken;
    anchorRect: AnchorRect;
    /** Reading language — drives which spelled-out form the tooltip
     *  surfaces for digit-only NUM tokens (T-2.8). The side panel
     *  shows all three; the tooltip is meant to be glanceable, so it
     *  only shows the one matching the text being read. Optional for
     *  backward-compat with callers that haven't been updated yet —
     *  when absent, number tokens fall back to the empty-state copy. */
    language?: LanguageCode;
    onClose?: () => void;
  }

  let { token, anchorRect, language, onClose }: Props = $props();
  const hindiCandidates = $derived.by(() => {
    const primary = {
      lemmaId: token.lemmaId, headword: token.headword ?? token.surface, pos: token.pos ?? '',
      glossDefault: token.glossDefault, personalGloss: token.personalGloss, selectedBy: token.selectedBy,
    };
    if (token.correctedByViewer) return [primary];
    const all = [primary, ...token.candidates];
    const selected = all.filter(candidate => candidate.selectedBy);
    return selected.length ? selected : all;
  });

  const numberForm = $derived.by<ServerNumberLanguageForm | null>(() => {
    if (!token.numberForms) return null;

    switch (language) {
      case 'hi': return token.numberForms.hi;
      case 'mr': return token.numberForms.mr;
      case 'or': return token.numberForms.odia;
      case 'eu': return token.numberForms.eu;
      default: return null;
    }
  });

  // T-2.8: legacy data fallback. The chapter was processed before the
  // worker started writing number_forms, so we have no spelled-out
  // payload — but we can at least recognize the surface as a number
  // and stop the tooltip from claiming "No translations" / "No
  // dictionary match", which is misleading.
  const isLegacyNumber = $derived(
    !token.numberForms && looksLikeNumberToken(token.surface),
  );

  let tipEl: HTMLDivElement | null = $state(null);
  let measured = $state<{ w: number; h: number } | null>(null);

  // T-5.28: portal to <body>. `position: fixed` sits relative to the
  // nearest ancestor with `transform`, `backdrop-filter`, `filter`,
  // or `will-change` (a CSS containing-block gotcha). The reader
  // wraps tokens in a translateY-driven page slider, and Sheet's
  // backdrop has `backdrop-filter: blur` — both create new
  // containing blocks that throw off our viewport-relative
  // coordinates. Portaling lifts the tooltip out so its `position:
  // fixed` is genuinely viewport-relative again.
  function portal(node: HTMLElement) {
    if (typeof document === 'undefined') return {};
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }

  // Placement is derived from the anchor + measured dimensions so it
  // re-runs whenever the parent rebinds the tooltip to a new word.
  // Defaults seed the first paint near the word; the $effect below
  // refines once we measure for real.
  // T-5.1c: when the soft keyboard is up, `window.visualViewport.height`
  // shrinks. Using it as the placement viewport keeps the tooltip
  // visible above the keyboard instead of slipping behind it.
  const placement = $derived.by(() => {
    const w = measured?.w ?? 240;
    const h = measured?.h ?? 80;
    const vw =
      typeof window !== 'undefined'
        ? window.visualViewport?.width ?? window.innerWidth
        : 1024;
    const vh =
      typeof window !== 'undefined'
        ? window.visualViewport?.height ?? window.innerHeight
        : 768;
    return placeTooltip(anchorRect, w, h, { width: vw, height: vh });
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
  onpointerleave={(event) => { if (event.pointerType !== 'touch') onClose?.(); }}
  use:portal
  style:top="{placement.top}px"
  style:left="{placement.left}px"
>
  <div class="tip-head">
    <span class="tip-w">{token.surface}</span>
    <!-- T-2.8: for number tokens the romanization field carries the
         literal digit string ("123" → "123") which is just noise in
         the head; suppress it and let the spelled-out form below do
         the work. Same suppression for legacy number tokens whose
         numberForms payload is missing. -->
    {#if token.romanization && !numberForm && !isLegacyNumber}
      <span class="tip-roman">{token.romanization}</span>
    {/if}
  </div>
  {#if numberForm}
    <!-- T-2.8: digit-only NUM token. Show the spelled-out form for
         the reading language + its romanization (the click panel has
         more). Latin-script languages (Basque) carry no separate
         romanization, so the stripe is suppressed when it's empty. -->
    <div class="tip-def">
      {numberForm.spelled}
      {#if numberForm.romanized}
        <span class="tip-roman num-roman">{numberForm.romanized}</span>
      {/if}
    </div>
  {:else if isLegacyNumber}
    <div class="tip-def empty" data-testid="legacy-number">Number</div>
  {:else if language === 'hi' && token.lemmaId}
    {#each hindiCandidates as candidate (candidate.lemmaId)}
      <section class="tip-candidate" data-lemma-id={candidate.lemmaId}>
        <div class="tip-head">{#if hindiCandidates.length > 1 || candidate.headword !== token.surface}<span class="tip-w">{candidate.headword}</span>{/if}<PosPill pos={candidate.pos} /></div>
        {#if candidate.personalGloss || candidate.glossDefault}
          <div class="tip-def"><DefinitionMeanings text={candidate.personalGloss || candidate.glossDefault || ''} /></div>
        {:else}
          <div class="tip-def empty">No translations</div>
        {/if}
      </section>
    {/each}
  {:else if token.isOov && !token.personalGloss}
    <!-- T-5.20: surface the top translation when we have one, fall
         back to an italic "No translations" otherwise so the user
         always knows whether the lookup is empty or just absent. The
         tooltip stays no-fetch — it reads `glossDefault` off the token
         row, which the side-panel still backs up with the full
         hierarchy on click. A user-supplied translation overrides the
         OOV copy so words the reader has chosen to translate read in
         their own words even when the dictionary missed them. -->
    <div class="tip-def empty">No dictionary match</div>
  {:else if token.personalGloss}
    <div class="tip-def" data-testid="tip-personal">
      <DefinitionMeanings text={token.personalGloss} />
    </div>
  {:else if token.glossDefault}
    <div class="tip-def"><DefinitionMeanings text={token.glossDefault} /></div>
  {:else}
    <div class="tip-def empty">No translations</div>
  {/if}
</div>

<style>
  .tip {
    position: fixed;
    /* Above the side panel (z-index 40) so the tooltip shows even when
     * the user is hovering a word that lives under where the panel
     * sits — which is most of the right half of the reader. */
    z-index: 50;
    background: var(--ink, #1f1a14);
    color: var(--paper, #fdfaf3);
    border-radius: 8px;
    padding: 0.55rem 0.75rem;
    font-size: 0.78rem;
    font-family: var(--font-sans, system-ui, sans-serif);
    max-width: min(28rem, calc(100vw - 24px));
    max-height: 70vh;
    overflow-y: auto;
    pointer-events: auto;
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
  .tip-candidate + .tip-candidate {
    border-top: 1px solid color-mix(in oklch, var(--paper, #fdfaf3) 20%, transparent);
    margin-top: 0.6rem;
    padding-top: 0.6rem;
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
  }
  /* T-2.8: small romanization stripe inside the gloss row for
   * number tokens. Same colour ramp as the head romanization. */
  .num-roman {
    margin-left: 0.45rem;
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
