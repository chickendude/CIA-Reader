<script lang="ts">
  import Button from '$lib/components/input/Button.svelte';
  import type { PageData } from './$types';

  let { comparison, title }: { comparison: PageData['comparison']; title: string } = $props();
  const percent = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
</script>

<section aria-labelledby="compare-title">
  <h2 id="compare-title">Compare books</h2>
  {#if comparison.books.length}
    <form method="GET" data-sveltekit-noscroll>
      <label>Book you know
        <select name="from" required value={comparison.source?.id ?? ''}>
          <option value="" disabled>Choose a book</option>
          {#each comparison.books as book (book.id)}
            <option value={book.id}>{book.title}</option>
          {/each}
        </select>
      </label>
      <label>Known coverage (%)
        <input name="known" type="number" min="0" max="100" step="0.1" required value={comparison.known} />
      </label>
      <label>Target coverage (%)
        <input name="goal" type="number" min="0" max="100" step="0.1" required value={comparison.goal} />
      </label>
      <Button type="submit">Compare</Button>
    </form>
    {#if comparison.result && comparison.source}
      {@const result = comparison.result}
      {#if result.kind === 'estimate'}
        <p>Knowing {comparison.known}% of {comparison.source.title} covers an estimated
          <strong>{percent.format(result.coverage)}%</strong> of {title}.
          {#if result.additionalWords === null}
            Unresolved words limit coverage to {percent.format(result.maximum)}%, below your {comparison.goal}% target.
          {:else if result.additionalWords === 0}
            You already meet the {comparison.goal}% target with those words.
          {:else}
            Learn <strong>{result.additionalWords.toLocaleString()} more {result.additionalWords === 1 ? 'word' : 'words'}</strong> to reach {comparison.goal}%.
          {/if}
        </p>
      {:else if result.kind === 'source-limit'}
        <p>Unresolved words limit coverage in {comparison.source.title} to {percent.format(result.maximum)}%. Choose a lower known coverage.</p>
      {:else}
        <p>Both books need vocabulary analysis before they can be compared.</p>
      {/if}
    {/if}
  {:else}
    <p>No other books in this language are ready to compare.</p>
  {/if}
</section>

<style>
  section { border-top: 1px solid var(--rule); padding: 1.5rem 0; }
  h2 { font-size: 1.1rem; margin: 0 0 1rem; }
  form { display: flex; align-items: end; flex-wrap: wrap; gap: .75rem; }
  label { display: grid; gap: .35rem; font-size: .85rem; min-width: 0; }
  input, select {
    box-sizing: border-box; max-width: 100%; min-height: 2.25rem; padding: .4rem .55rem;
    background: var(--paper); color: var(--ink); border: 1px solid var(--rule);
    border-radius: 5px; font: inherit;
  }
  input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  p { margin: 1rem 0 0; line-height: 1.6; }
</style>
