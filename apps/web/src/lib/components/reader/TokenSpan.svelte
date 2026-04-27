<!--
  Single token render (T-5.2, romanization in T-5.3).

  One `<span>` per token, with a `.status-*` class when we have a
  lemma resolution. Word tokens get a hover affordance. Whitespace
  tokens render as plain text without any classes — the reader
  preserves the original layout faithfully.

  When `showRomanization` is on AND the token has a precomputed
  `romanization` (worker-time, T-2.5), the surface form renders
  inside an HTML `<ruby>` element with the romanized form on top so
  learners who aren't yet fluent in the script can decode each word
  inline. Tokens without a romanization just render the surface.
-->
<script lang="ts">
  import type { ServerToken } from './types.js';

  let {
    token,
    showRomanization = false,
  }: { token: ServerToken; showRomanization?: boolean } = $props();

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

  const showRuby = $derived(
    showRomanization && token.isWord && Boolean(token.romanization),
  );
</script>

{#if !token.isWord}{token.surface}{:else if showRuby}<ruby
    class={cssClass}
    data-token-id={token.id}
    data-token-idx={token.idx}
    data-lemma-id={token.lemmaId ?? ''}>{token.surface}<rt>{token.romanization}</rt></ruby>{:else}<span
    class={cssClass}
    data-token-id={token.id}
    data-token-idx={token.idx}
    data-lemma-id={token.lemmaId ?? ''}>{token.surface}</span>{/if}

<style>
  .word {
    cursor: pointer;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .word:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  /* `<ruby>` defaults to `display: ruby` which behaves like an inline
     element — perfect for in-line text. We only need to nudge the
     `<rt>` styling. */
  ruby.word rt {
    font-size: 0.6em;
    color: var(--color-fg-muted);
    line-height: 1.1;
    /* Tight character spacing on rt so a long romanization doesn't
       blow the underlying word's width out. */
    letter-spacing: -0.01em;
  }
  .status-unknown {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }
  .status-learning {
    background: color-mix(in srgb, #b07a31 30%, transparent);
    color: var(--color-fg);
  }
  .status-known,
  .status-ignored {
    background: transparent;
  }
  .oov {
    background: transparent;
    border-bottom: 1px dashed var(--color-fg-muted);
    border-radius: 0;
  }
  .ambiguous::after {
    content: '·';
    color: var(--color-accent);
    margin-left: 0.05em;
    vertical-align: super;
    font-size: 0.7em;
  }
</style>
