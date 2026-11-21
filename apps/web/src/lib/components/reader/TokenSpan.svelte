<!--
  Use ruby text to show a word's pronunciation above its original spelling when romanization is
  enabled.
-->
<script lang="ts">
  import { looksLikeNumberToken, statusToCode, type ServerToken } from './types.js';
  import { isIgnoredHere, readerOccurrenceIgnores } from './ignored-occurrences';

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

  const changes = readerOccurrenceIgnores();
  const ignored = $derived(isIgnoredHere(token, changes));

  // A dashed underline marks a missing dictionary entry. Learning status uses a separate style.
  const cssClass = $derived.by(() => {
    if (!token.isWord && !token.numberForms && !looksLikeNumberToken(token.surface)) return '';
    const classes: string[] = ['word'];
    if (!ignored && token.isOov) classes.push('oov');
    if (isAnchor) classes.push('anchor');
    if (!ignored && token.hasDefinition === false) classes.push('no-definition');
    return classes.join(' ');
  });

  // OOV tokens are categorically pre-status; the design dashes them
  // and skips the colored tint regardless of `data-hl`. We omit
  // data-s on those so the highlight rules never match.
  const dataS = $derived(
    token.isWord && !ignored && !token.isOov ? statusToCode(token.status) : undefined,
  );

  const showRuby = $derived(
    showRomanization && token.isWord && Boolean(token.romanization),
  );
</script>

{#if !token.isWord && !token.numberForms && !looksLikeNumberToken(token.surface)}{token.surface}{:else if showRuby}<ruby
    class={cssClass}
    data-token-id={token.id}
    data-token-idx={token.idx}
    data-token-last={token.lastTokenIdx}
    data-lemma-id={token.lemmaId ?? ''}
    data-s={dataS}>{token.surface}<rt>{token.romanization}</rt></ruby>{:else}<span
    class={cssClass}
    data-token-id={token.id}
    data-token-idx={token.idx}
    data-token-last={token.lastTokenIdx}
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
  :global([data-hl='none']) .oov {
    border-bottom: 0;
  }
  /* karaoke-style highlight on the word currently being
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
