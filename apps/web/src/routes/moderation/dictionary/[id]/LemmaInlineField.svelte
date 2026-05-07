<!--
  Click-to-edit field for the lemma identity strip.

  The element is ALWAYS an `<input>` or `<textarea>` — there's no
  swap into a `<button>` for the read state. Visual state is driven
  purely by CSS `:focus` / `:hover` so dimensions are guaranteed
  identical: clicking can't reflow because the same element handles
  both states. Auto-width on single-line inputs comes from
  `field-sizing: content`; the multiline textarea uses normal
  `flex: 1` so the gloss fills the rest of the inline lemma row.

  Each field POSTs `{field, value}` to `?/patchLemmaField` on commit
  via SvelteKit's `enhance`, so a single character change doesn't
  resubmit the whole lemma row.
-->
<script lang="ts">
  import { enhance } from '$app/forms';

  interface Props {
    /** Server field name. POSTed as the `field` form value. */
    field:
      | 'headword'
      | 'pos'
      | 'glossDefault'
      | 'frequencyRank'
      | 'sourceAttribution';
    /** Current persisted value. Empty string for a missing optional field. */
    value: string;
    /** Placeholder shown when `value` is empty (typed into the
     *  input's native `placeholder` attribute, so it disappears on
     *  focus). */
    placeholder: string;
    /** Optional language tag for native-script rendering. */
    lang?: string;
    /** When true, render with the "script" face (Devanagari/Odia). */
    script?: boolean;
    /** When true, use a `<textarea>` (flex-fill width). */
    multiline?: boolean;
    /** When true, use `type="number"`. */
    numeric?: boolean;
    /** Extra class hook for layout positioning. */
    class?: string;
  }

  let {
    field,
    value,
    placeholder,
    lang,
    script = false,
    multiline = false,
    numeric = false,
    class: extraClass = '',
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state(value);
  let formEl = $state<HTMLFormElement | null>(null);
  let inputEl = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Re-sync draft from the server-side prop whenever it changes AND
  // the user isn't currently focused inside this input. Prevents
  // overwriting the user's in-progress typing when the parent
  // re-renders for unrelated reasons.
  $effect(() => {
    if (inputEl && document.activeElement === inputEl) return;
    draft = value;
  });

  function commit(): void {
    if (draft === value) return;
    formEl?.requestSubmit();
  }

  function cancel(): void {
    draft = value;
    inputEl?.blur();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
      return;
    }
    if (multiline) {
      // Plain Enter inserts a newline; ⌘/Ctrl+Enter commits.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputEl?.blur();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      inputEl?.blur();
    }
  }
</script>

<form
  method="post"
  action="?/patchLemmaField"
  use:enhance={() =>
    ({ update }) => update({ reset: false })}
  bind:this={formEl}
  class="lif-form {multiline ? 'lif-form-multi' : ''} {extraClass}"
>
  <input type="hidden" name="field" value={field} />
  {#if multiline}
    <textarea
      bind:this={inputEl}
      bind:value={draft}
      name="value"
      rows="1"
      {placeholder}
      onblur={commit}
      onkeydown={onKey}
      class="lif-input lif-multi {extraClass}"
      class:lif-script={script}
      class:lif-empty={draft.length === 0}
      {lang}
      title="Click to edit"
    ></textarea>
  {:else}
    <input
      bind:this={inputEl}
      bind:value={draft}
      name="value"
      type={numeric ? 'number' : 'text'}
      min={numeric ? 0 : undefined}
      {placeholder}
      onblur={commit}
      onkeydown={onKey}
      class="lif-input {extraClass}"
      class:lif-script={script}
      class:lif-empty={draft.length === 0}
      style:width={`${Math.max(
        (draft.length || placeholder.length || 1) + 0.5,
        1.5,
      )}ch`}
      {lang}
      title="Click to edit"
    />
  {/if}
</form>

<style>
  /* Form is an inline-flex wrapper. It participates in the parent
     flex layout normally — when the parent passes a layout class
     like `mli-gloss` (which carries `flex: 1` and `min-width:
     14rem`), the form grows to fill the row. Single-line fields
     get content-sized because the form has no flex-grow without
     that class. */
  .lif-form {
    display: inline-flex;
    align-items: baseline;
  }
  /* The single element drives both read and edit. We strip every
     native control style off, then layer focus-state visuals via
     `outline` + `background-color` (both layout-neutral). Because
     the element never swaps, dimensions can't change between
     states. */
  .lif-input {
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: inherit;
    /* Tiny horizontal padding so the focus outline doesn't sit
       flush against the glyphs. Vertical padding stays 0 so the
       input doesn't bulge taller than surrounding text. */
    padding: 0 0.15em;
    margin: 0;
    text-align: left;
    vertical-align: baseline;
    border-radius: 3px;
    cursor: pointer;
    /* Auto-width: shrink/grow with content via `field-sizing:
       content`. No `size` attribute — it would reserve a fixed
       number of character slots even when content is shorter
       (causing the visible "extra padding" the curator saw). */
    width: auto;
    min-width: 1ch;
    field-sizing: content;
    /* `flex: 0 0 auto` keeps the input from growing past content
       inside an inline-flex form (single-line case). The textarea
       overrides this below for the gloss flex-fill. */
    flex: 0 0 auto;
  }
  /* Subtle hover affordance — the curator can see this is editable
     without clicking. Layout-neutral background tint only. */
  .lif-input:hover:not(:focus) {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  /* Edit state. Outline + offset both sit OUTSIDE the box so the
     dimensions don't change. */
  .lif-input:focus {
    cursor: text;
    outline: 1.5px solid var(--color-accent);
    outline-offset: 2px;
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  }
  /* Empty placeholder feels lighter so it reads as "absent" rather
     than "real text". */
  .lif-input:placeholder-shown {
    font-style: italic;
    color: color-mix(in srgb, currentColor 65%, transparent);
  }
  /* Multiline textarea fills the available width inside the form;
     the form itself fills the row when it carries `mli-gloss`.
     Extra vertical breathing room on the gloss specifically — its
     wrapped lines need space to not feel cramped (single-line
     inputs don't need it). */
  textarea.lif-multi {
    flex: 1 1 auto;
    width: 100%;
    padding: 0.3em 0.4em;
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
  }
  .lif-script {
    font-family: var(--font-script, var(--font-serif, serif));
  }
</style>
