<!--
  Single token render (T-5.2).

  One `<span>` per token, with a `.status-*` class when we have a
  lemma resolution. Word tokens get a hover affordance. Whitespace
  tokens render as plain text without any classes — the reader
  preserves the original layout faithfully.

  T-5.4 layers the word pop-up on top of this; T-5.5 wires status
  changes back to the server. The classes are stable so those tickets
  don't have to touch markup.
-->
<script lang="ts">
  import type { ServerToken } from './types.js';

  let {
    token,
  }: { token: ServerToken } = $props();

  // OOV tokens get a distinct visual state (T-5.4a) — dashed
  // underline rather than the known/unknown highlight, so the user
  // sees them as "no dictionary match yet" not "you don't know this
  // word."
  const cssClass = $derived.by(() => {
    if (!token.isWord) return '';
    const classes: string[] = ['word'];
    if (token.isOov) classes.push('oov');
    else classes.push(`status-${token.status}`);
    if (token.isAmbiguous) classes.push('ambiguous');
    return classes.join(' ');
  });
</script>

{#if token.isWord}<span
    class={cssClass}
    data-token-id={token.id}
    data-token-idx={token.idx}
    data-lemma-id={token.lemmaId ?? ''}>{token.surface}</span>{:else}{token.surface}{/if}

<style>
  .word {
    cursor: pointer;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .word:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  /* Default — token has a lemma but the user hasn't marked it. The
     LingQ-style "this is a word you should pay attention to" colour. */
  .status-unknown {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }
  .status-learning {
    background: color-mix(in srgb, #b07a31 30%, transparent);
    color: var(--color-fg);
  }
  /* Known + ignored: render as plain text, no highlight. */
  .status-known,
  .status-ignored {
    background: transparent;
  }
  /* OOV: no dictionary match — dashed underline rather than a
     highlight, so the user knows the system needs help on this token. */
  .oov {
    background: transparent;
    border-bottom: 1px dashed var(--color-fg-muted);
    border-radius: 0;
  }
  /* Ambiguous: an extra dot above to hint that there are alternate
     parses available (T-6.1's "N possible meanings" chevron lives in
     the pop-up; this is the at-a-glance affordance). */
  .ambiguous::after {
    content: '·';
    color: var(--color-accent);
    margin-left: 0.05em;
    vertical-align: super;
    font-size: 0.7em;
  }
</style>
