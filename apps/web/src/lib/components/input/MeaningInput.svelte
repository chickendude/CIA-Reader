<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { serializeMeanings, splitMeanings } from '$lib/dictionary/meanings';

  let {
    value = $bindable(''),
    label,
    name,
    id,
    required = false,
    placeholder,
    maxlength,
    sheet = false,
    focusOnMount = false,
    disabled = false,
    onsave = () => textarea.form?.requestSubmit(),
    oncancel,
    onblur,
  }: {
    value?: string;
    label: string;
    name?: string;
    id?: string;
    required?: boolean;
    placeholder?: string;
    maxlength?: number;
    sheet?: boolean;
    focusOnMount?: boolean;
    disabled?: boolean;
    onsave?: () => void;
    oncancel?: () => void;
    onblur?: () => void;
  } = $props();

  let field: HTMLDivElement;
  let textarea: HTMLTextAreaElement;
  let tabbing = false;
  let draft = $state(untrack(() => splitMeanings(value).join('\n')));
  const lines = $derived(draft.split('\n'));

  // Keep blank lines and trailing spaces while typing. Only replace the draft
  // when the caller supplies a different definition.
  $effect(() => {
    const next = value;
    if (serializeMeanings(next) !== untrack(() => serializeMeanings(draft))) {
      draft = splitMeanings(next).join('\n');
    }
  });

  onMount(() => {
    if (focusOnMount) {
      textarea.focus();
      textarea.setSelectionRange(draft.length, draft.length);
    }
  });

  // A touch outside the editor can leave the textarea focused. Capture the click
  // before another reader control closes the sheet or selects a different word.
  $effect(() => {
    const saveOutside = onblur;
    if (!sheet || !saveOutside) return;
    const outside = (event: MouseEvent) => {
      if (!event.composedPath().includes(field)) commit(saveOutside);
    };
    document.addEventListener('click', outside, true);
    return () => document.removeEventListener('click', outside, true);
  });

  function commit(callback: () => void) {
    if (!disabled && textarea.reportValidity()) callback();
  }
</script>

<div bind:this={field} class="field" class:sheet class:with-cancel={sheet && !!oncancel}
  style:--digits={String(lines.length).length}
  onkeydowncapture={(event) => { tabbing = event.key === 'Tab'; }}
  onfocusout={(event) => {
    if (sheet && tabbing && onblur && !field.contains(event.relatedTarget as Node | null)) commit(onblur);
    tabbing = false;
  }}>
  <!-- Match the textarea's wrapping so only the first visual line of each meaning gets a number. -->
  <div class="measure" aria-hidden="true">
    {#each lines as line, i}
      <div class="line"><span class="number">{i + 1}.</span><span class="copy">{line || '\u00a0'}</span></div>
    {/each}
  </div>
  <textarea bind:this={textarea} value={draft} rows="1" {name} {id} {maxlength} {placeholder} {required}
    aria-label={label} readonly={disabled} enterkeyhint={sheet ? 'enter' : 'done'}
    oninput={(event) => {
      draft = event.currentTarget.value;
      value = serializeMeanings(draft);
      textarea.setCustomValidity(maxlength && value.length > maxlength ? `Use at most ${maxlength} characters.` : '');
    }}
    onkeydown={(event) => {
      if (disabled || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && !event.shiftKey && !sheet) {
        event.preventDefault();
        event.stopPropagation();
        commit(onsave);
      } else if (event.key === 'Escape' && oncancel) {
        event.preventDefault();
        event.stopPropagation();
        oncancel();
      }
    }}
    onblur={() => { if (!sheet && onblur) commit(onblur); }}
  ></textarea>
  {#if sheet}
    <button type="button" aria-label="Save definition" title="Save definition" {disabled} onclick={() => commit(onsave)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m5 12 4 4L19 6" />
      </svg>
    </button>
    {#if oncancel}
      <button class="cancel" type="button" aria-label="Cancel definition changes" title="Cancel changes"
        {disabled} onclick={oncancel}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    {/if}
  {/if}
</div>

<style>
  .field {
    --gutter: calc(var(--digits) * 1ch + 1.15em);
    position: relative;
    width: 100%;
    min-width: 0;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    color: var(--ink, var(--color-fg));
    background: var(--card, var(--color-bg));
    line-height: 1.4;
  }
  .field:focus-within { outline: 2px solid var(--accent, var(--color-accent)); }
  .sheet { --end: 2.9rem; min-height: 2.75rem; }
  .with-cancel { min-height: 5.5rem; }
  .cancel { top: 2.75rem; color: var(--ink-2, var(--color-fg-muted)); }
  .measure, textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 0.45rem var(--end, 0.6rem) 0.45rem var(--gutter);
    font: inherit;
    letter-spacing: inherit;
    text-align: start;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    tab-size: 8;
  }
  .measure { pointer-events: none; }
  .line { position: relative; }
  .copy { visibility: hidden; }
  .number {
    position: absolute;
    inset-inline-end: calc(100% + 0.3em);
    color: var(--ink-3, var(--color-fg-muted));
    font-variant-numeric: tabular-nums;
  }
  textarea {
    position: absolute;
    inset: 0;
    height: 100%;
    margin: 0;
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: inherit;
  }
  button {
    position: absolute;
    inset: 0 0 auto auto;
    width: 2.75rem;
    height: 2.75rem;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--accent, var(--color-accent));
    cursor: pointer;
  }
</style>
