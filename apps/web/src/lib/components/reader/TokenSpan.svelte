<!--
  Single token render (T-5.2, romanization in T-5.3, status modes in T-5.9).

  One `<span>` per token, with a numeric `data-s` attribute when we
  have a lemma resolution. The colored highlight rules live in
  `tokens.css` and are switched between background-tint and underline
  modes via `data-hl` on `<html>`. Whitespace tokens render as plain
  text without any classes.

  When `showRomanization` is on AND the token has a precomputed
  `romanization` (worker-time, T-2.5), the surface form renders
  inside an HTML `<ruby>` element with the romanized form on top so
  learners who aren't yet fluent in the script can decode each word
  inline.
-->
<script lang="ts">
  import { statusToCode, type ServerToken } from './types.js';

  let {
    token,
    showRomanization = false,
    isAnchor = false,
  }: {
    token: ServerToken;
    showRomanization?: boolean;
    /** True when this token is the one currently locked in the side
     *  panel — gets an outline so the user remembers which word the
     *  panel is bound to. */
    isAnchor?: boolean;
  } = $props();

  // OOV tokens get a distinct visual state (T-5.4a) — dashed
  // underline rather than the known/unknown highlight, so the user
  // sees them as "no dictionary match yet" not "you don't know this
  // word."
  const cssClass = $derived.by(() => {
    if (!token.isWord) return '';
    const classes: string[] = ['word'];
    if (token.isOov) classes.push('oov');
    if (token.isAmbiguous) classes.push('ambiguous');
    if (isAnchor) classes.push('anchor');
    return classes.join(' ');
  });

  // OOV tokens are categorically pre-status; the design dashes them
  // and skips the colored tint regardless of `data-hl`. We omit
  // data-s on those so the highlight rules never match.
  const dataS = $derived(
    token.isWord && !token.isOov ? statusToCode(token.status) : undefined,
  );

  const showRuby = $derived(
    showRomanization && token.isWord && Boolean(token.romanization),
  );
</script>

{#if !token.isWord}{token.surface}{:else if showRuby}<ruby
    class={cssClass}
    data-token-id={token.id}
    data-token-idx={token.idx}
    data-lemma-id={token.lemmaId ?? ''}
    data-s={dataS}>{token.surface}<rt>{token.romanization}</rt></ruby>{:else}<span
    class={cssClass}
    data-token-id={token.id}
    data-token-idx={token.idx}
    data-lemma-id={token.lemmaId ?? ''}
    data-s={dataS}>{token.surface}</span>{/if}

<style>
  .word {
    cursor: pointer;
    border-radius: 3px;
    padding: 0 1.5px;
    transition: background 120ms ease;
  }
  .word:hover {
    background: color-mix(in oklch, var(--accent) 28%, transparent);
  }
  /* `<ruby>` defaults to `display: ruby` which behaves like an inline
     element — perfect for in-line text. We only need to nudge the
     `<rt>` styling. */
  ruby.word rt {
    font-size: 0.6em;
    color: var(--ink-3, var(--color-fg-muted));
    line-height: 1.1;
    /* Tight character spacing on rt so a long romanization doesn't
       blow the underlying word's width out. */
    letter-spacing: -0.01em;
  }
  .oov {
    background: transparent;
    border-bottom: 1px dashed var(--color-fg-muted);
    border-radius: 0;
  }
  .ambiguous::after {
    content: '·';
    color: var(--accent, var(--color-accent));
    margin-left: 0.05em;
    vertical-align: super;
    font-size: 0.7em;
  }
  /* T-9.3: karaoke-style highlight on the word currently being
     spoken in the audio. Higher contrast than hover/anchor so the
     reader can track the playhead at a glance. */
  :global(.playing) {
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg, #fff));
    border-radius: 3px;
    transition: background 80ms ease;
  }
  /* Anchor: the word currently locked in the side panel. Outline
     instead of fill so the user can still see the underlying status
     tint underneath. Negative offset tucks the outline against the
     border-edge so it can't bleed past column edges (where
     overflow:hidden would clip an outline on the leftmost word in
     a page). */
  .word.anchor {
    outline: 1px solid color-mix(in oklch, var(--accent, var(--color-accent)) 45%, transparent);
    outline-offset: -1px;
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 8%, transparent);
    border-radius: 3px;
  }
</style>
