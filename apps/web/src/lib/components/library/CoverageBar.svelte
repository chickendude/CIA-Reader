<script lang="ts">
  import type { BookWordStats } from '$lib/server/texts/book-stats.js';

  let { stats }: { stats: BookWordStats } = $props();
  const tooltipId = $props.id();
  let area: HTMLDivElement;
  let mode = $state<'hover' | 'focus' | 'pinned' | null>(null);
  const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
  const known = $derived(100 * stats.knownWords / stats.words);
  const learning = $derived(100 * stats.learningWords / stats.words);

  $effect(() => {
    if (!mode) return;
    function dismissOutside(event: PointerEvent) {
      if (!event.composedPath().includes(area)) mode = null;
    }
    function dismissEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') mode = null;
    }
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissEscape);
    };
  });
</script>

<div class="coverage-control" role="presentation" bind:this={area}
  onpointerenter={(event) => { if (event.pointerType === 'mouse' && !mode) mode = 'hover'; }}
  onpointerleave={() => { if (mode === 'hover') mode = null; }}>
  <button type="button" aria-label="Vocabulary coverage breakdown" aria-expanded={mode !== null}
    aria-describedby={mode ? tooltipId : undefined}
    onfocus={(event) => { if (event.currentTarget.matches(':focus-visible')) mode = 'focus'; }}
    onblur={() => mode = null}
    onclick={() => mode = mode === 'pinned' ? null : 'pinned'}>
    <span class="track" aria-hidden="true">
      <span class="known" style:width={known + '%'}></span>
      <span class="learning" style:width={learning + '%'}></span>
    </span>
  </button>
  {#if mode}
    <div class="breakdown" id={tooltipId} role="tooltip">
      <div><span class="key known"></span>Known <strong>{number.format(known)}%</strong> ({number.format(stats.knownWords)} {stats.knownWords === 1 ? 'word' : 'words'})</div>
      <div><span class="key learning"></span>Learning <strong>{number.format(learning)}%</strong> ({number.format(stats.learningWords)} {stats.learningWords === 1 ? 'word' : 'words'})</div>
    </div>
  {/if}
</div>

<style>
  .coverage-control { position: relative; z-index: 2; }
  button { display: flex; align-items: center; width: 100%; min-height: 1.6rem; padding: 0; background: none; border: 0; border-radius: .3rem; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .track { display: flex; height: .35rem; width: 100%; border-radius: 1rem; overflow: hidden; background: var(--rule); }
  .known { background: var(--accent); }
  .learning { background: color-mix(in srgb, var(--accent) 45%, var(--paper)); }
  .breakdown { position: absolute; inset: 100% auto auto 0; z-index: 1; box-sizing: border-box; width: max-content; max-width: 100%; padding: .5rem .65rem; background: var(--card); color: var(--ink); border: 1px solid var(--rule); border-radius: .45rem; box-shadow: var(--shadow-2); font-size: .78rem; line-height: 1.5; font-weight: 400; }
  .key { display: inline-block; width: .5rem; height: .5rem; margin-inline-end: .25rem; border-radius: 50%; }
  @media (pointer: coarse) { button { min-height: 2.75rem; } }
</style>
