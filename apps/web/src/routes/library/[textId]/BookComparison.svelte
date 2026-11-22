<script lang="ts">
  import { navigating, page } from '$app/state';
  import Button from '$lib/components/input/Button.svelte';
  import Modal from '$lib/components/overlay/Modal.svelte';
  import type { PageData } from './$types';

  let { comparison, books, title }: { books: PageData['books']; comparison: PageData['comparison']; title: string } = $props();
  let open = $derived(page.url.searchParams.has('from'));
  const comparing = $derived(navigating.to?.url.pathname === page.url.pathname && navigating.to.url.searchParams.has('from'));
  const percent = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
</script>

<Button aria-haspopup="dialog" onclick={() => open = true}>Compare books</Button>
<Modal {open} onClose={() => open = false} title="Compare books">
  {#if books.length}
    <form onsubmit={(event) => { if (comparing) event.preventDefault(); }} method="GET" data-sveltekit-noscroll data-sveltekit-keepfocus>
      <label class="source">Book you know
        <select name="from" required value={comparison.source?.id ?? ''}>
          <option value="" disabled>Choose a book</option>
          {#each books as book (book.id)}
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
      <div class="submit"><Button type="submit" variant="primary" aria-disabled={comparing}>{comparing ? 'Comparing…' : 'Compare'}</Button></div>
    </form>
    <div aria-live="polite">
      {#if comparing}
        <p>Calculating coverage…</p>
      {:else if comparison.result && comparison.source}
        {@const result = comparison.result}
        {#if result.kind === 'estimate'}
          <p>Knowing {comparison.known}% of {comparison.source.title} covers an estimated
            <strong>{percent.format(result.coverage)}%</strong> of {title}.
            {#if result.additionalWords === null}
              Unparsed words limit estimated coverage to {percent.format(result.maximum)}%, below your {comparison.goal}% target.
            {:else if result.additionalWords === 0}
              You already meet the {comparison.goal}% target with those words.
            {:else}
              Learn <strong>{result.additionalWords.toLocaleString()} more {result.additionalWords === 1 ? 'word' : 'words'}</strong> to reach {comparison.goal}%.
            {/if}
          </p>
        {:else if result.kind === 'source-limit'}
          <p>The dictionary matches {percent.format(result.maximum)}% of the words in {comparison.source.title}. Choose a known coverage at or below that percentage.</p>
        {:else}
          <p>Both books need vocabulary analysis before they can be compared.</p>
        {/if}
      {/if}
    </div>
  {:else}
    <p>No other books in this language are ready to compare.</p>
  {/if}
</Modal>

<style>
  form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
  .source, .submit { grid-column: 1 / -1; }
  .submit { justify-self: end; }
  label { display: grid; gap: .35rem; font-size: .85rem; min-width: 0; }
  input, select {
    box-sizing: border-box; max-width: 100%; min-height: 2.25rem; padding: .4rem .55rem;
    background: var(--paper); color: var(--ink); border: 1px solid var(--rule);
    border-radius: 5px; font: inherit;
  }
  input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  p { margin: 1rem 0 0; line-height: 1.6; }
</style>
