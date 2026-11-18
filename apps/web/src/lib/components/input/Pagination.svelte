<script lang="ts">
  import Button from './Button.svelte';

  type Navigation =
    | { hrefFor: (offset: number) => string; onPage?: never }
    | { onPage: (offset: number) => void; hrefFor?: never };

  type Props = Navigation & {
    offset: number;
    limit: number;
    total?: number;
    hasNext?: boolean;
    disabled?: boolean;
    label?: string;
  };

  let {
    offset,
    limit,
    total,
    hasNext,
    disabled = false,
    label = 'Pagination',
    hrefFor,
    onPage,
  }: Props = $props();
  const page = $derived(Math.floor(offset / limit) + 1);
  const pages = $derived(total === undefined ? undefined : Math.ceil(total / limit));
  const pageLabel = $derived(pages !== undefined && page <= pages ? `Page ${page} of ${pages}` : `Page ${page}`);
  const canAdvance = $derived(total === undefined ? hasNext : offset + limit < total);
</script>

{#snippet control(text: string, target: number, rel: 'prev' | 'next', available: boolean)}
  {#if hrefFor}
    <Button href={hrefFor(target)} {rel} disabled={disabled || !available}>{text}</Button>
  {:else}
    <Button onclick={() => onPage?.(target)} disabled={disabled || !available}>{text}</Button>
  {/if}
{/snippet}

{#if total !== 0 || offset > 0}
  <nav aria-label={label} dir="ltr">
    <span class="page-info" aria-live="polite">{pageLabel}</span>
    <div class="controls">
      {@render control('Previous', Math.max(0, offset - limit), 'prev', offset > 0)}
      {@render control('Next', offset + limit, 'next', !!canAdvance)}
    </div>
  </nav>
{/if}

<style>
  nav,
  .controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  nav {
    flex-wrap: wrap;
    justify-content: space-between;
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--rule, var(--color-border));
  }
  .page-info {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
</style>
