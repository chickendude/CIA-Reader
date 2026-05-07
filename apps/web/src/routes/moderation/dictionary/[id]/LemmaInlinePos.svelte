<!--
  POS picker — saffron pill that pops open a 2-column grid of the
  fixed UD POS values supported in this codebase. The trigger reads
  out the current value in monospace uppercase; the menu's selected
  option carries an accent-tinted highlight.

  Posts to `?/patchLemmaField` with `field=pos` on selection so the
  page's per-field save path is reused unchanged. Esc / outside-
  click closes the menu without saving.
-->
<script lang="ts">
  import { enhance } from '$app/forms';

  interface Props {
    /** Current persisted POS string (e.g. "VERB"). */
    value: string;
    /** Optional class hook for layout positioning. */
    class?: string;
  }

  let { value, class: extraClass = '' }: Props = $props();

  // UD POS options exposed in this curator UI. Order matches the
  // design mock's 5×2 grid; column flow is left-to-right top-down.
  const POS_OPTIONS: ReadonlyArray<string> = [
    'NOUN', 'VERB',
    'ADJ', 'ADV',
    'PRON', 'POSTP',
    'CONJ', 'PARTICLE',
    'NUMERAL', 'AUX',
  ];

  let open = $state(false);
  let wrapEl = $state<HTMLSpanElement | null>(null);
  let formEl = $state<HTMLFormElement | null>(null);
  // Initial pendingValue mirrors the prop; subsequent picks set it via
  // `pick(...)` before submitting the hidden form.
  // svelte-ignore state_referenced_locally
  let pendingValue = $state(value);

  function toggle(): void {
    open = !open;
  }
  function close(): void {
    open = false;
  }
  function pick(next: string): void {
    if (next === value) {
      close();
      return;
    }
    pendingValue = next;
    formEl?.requestSubmit();
  }

  // Close on outside click + Esc. We attach the listeners only when
  // open so the closed state is a no-op.
  $effect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      const target = e.target as Node | null;
      if (target && wrapEl && !wrapEl.contains(target)) close();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<span class="mli-pos-wrap {extraClass}" bind:this={wrapEl}>
  <button
    type="button"
    class="mli-pos"
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
    title="Click to change part of speech"
  >
    {value || 'pos'}
  </button>

  <form
    method="post"
    action="?/patchLemmaField"
    use:enhance={() =>
      ({ update }) => {
        close();
        return update({ reset: false });
      }}
    bind:this={formEl}
    style="display:none"
  >
    <input type="hidden" name="field" value="pos" />
    <input type="hidden" name="value" value={pendingValue} />
  </form>

  {#if open}
    <div class="mli-pos-menu" role="listbox">
      {#each POS_OPTIONS as opt (opt)}
        <button
          type="button"
          class="mli-pos-opt"
          class:on={opt === value}
          role="option"
          aria-selected={opt === value}
          onclick={() => pick(opt)}
        >
          {opt}
        </button>
      {/each}
    </div>
  {/if}
</span>

<style>
  .mli-pos-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  /* Saffron pill — the design's "VERB" trigger. Monospace, uppercase,
     letter-spaced; tinted with the accent so it reads as the lemma's
     defining tag. */
  .mli-pos {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-accent-ink, var(--color-accent));
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 0;
    cursor: pointer;
    line-height: 1;
  }
  .mli-pos:hover {
    background: color-mix(in srgb, var(--color-accent) 22%, transparent);
  }
  .mli-pos:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  /* 2-column popover. Mirrors the design's `.mli-pos-menu`. */
  .mli-pos-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--color-bg, white);
    border: 1px solid var(--color-border);
    border-radius: 7px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    padding: 4px;
    z-index: 60;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1px;
    min-width: 13rem;
  }
  .mli-pos-opt {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-fg);
    padding: 0.35rem 0.55rem;
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
  }
  .mli-pos-opt:hover {
    background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  }
  .mli-pos-opt.on {
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    color: var(--color-accent-ink, var(--color-accent));
  }
</style>
