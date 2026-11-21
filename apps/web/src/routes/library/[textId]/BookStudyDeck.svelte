<script lang="ts">
  import Button from '$lib/components/input/Button.svelte';
  import { studyDeckPlan, type DeckScope, type StudyBand } from '$lib/library/study-deck.js';

  let { book, bands, signedIn }: {
    book: { id: string; language: string }; bands: StudyBand[]; signedIn: boolean;
  } = $props();
  let scope = $state<DeckScope>('target');
  let target = $state<number | undefined>(98);
  let includeStudied = $state(false);
  let ignoreProper = $state(false);
  let ignoreLoans = $state(false);
  const valid = $derived(scope !== 'target' || (target !== undefined && target > 0 && target <= 100 && Number.isInteger(target * 10)));
  const plan = $derived(studyDeckPlan(bands, { scope, target: target ?? 98, ignoreProper, ignoreLoans, includeStudied }));
</script>

<section aria-labelledby="study-title">
  <h2 id="study-title">Study this book’s vocabulary</h2>
  <form method="GET" action={`/api/v1/texts/${book.id}/anki`} data-sveltekit-reload>
    <div class="settings">
      <label>Include
        <select name="scope" bind:value={scope}>
          <option value="target">Words needed for target</option>
          <option value="unknown">{includeStudied ? 'All non-ignored words' : 'All unseen words'}</option>
          <option value="learning">Learning words</option>
          <option value="all">All vocabulary</option>
        </select>
      </label>
      {#if scope === 'target'}
        <label>Target coverage (%)
          <input type="number" name="target" min="0.1" max="100" step="0.1" required bind:value={target} />
        </label>
      {/if}
    </div>
    <div class="filters">
      {#if scope === 'target' || scope === 'unknown'}
        <label><input type="checkbox" name="includeStudied" value="1" bind:checked={includeStudied} /> Include known and learning words</label>
      {/if}
      <label><input type="checkbox" name="ignoreProper" value="1" bind:checked={ignoreProper} /> Ignore proper nouns</label>
      {#if book.language === 'hi'}
        <label><input type="checkbox" name="ignoreLoans" value="1" bind:checked={ignoreLoans} /> Ignore English loans</label>
      {/if}
    </div>
    {#if scope === 'target'}
      <p>{includeStudied
        ? 'The deck includes the most frequent words until it reaches the target.'
        : 'Known and learning words count toward the target. The deck adds the most frequent unseen words first.'}</p>
    {/if}
    <div aria-live="polite">
      {#if valid}
        <strong>{plan.count.toLocaleString()} {plan.count === 1 ? 'card' : 'cards'}</strong>
        {#if scope === 'target' && plan.total}
          <span> for {Number((plan.covered / plan.total * 100).toFixed(2))}% {includeStudied ? 'deck coverage' : 'projected coverage'}.</span>
          {#if !plan.reached}<span> Unparsed words put the target out of reach.</span>{/if}
        {/if}
      {:else}
        Enter a target from 0.1% to 100% in steps of 0.1%.
      {/if}
    </div>
    {#if signedIn}
      <Button type="submit" disabled={!valid || !plan.count}>Download Anki deck</Button>
    {:else}
      <p><a href={`/login?next=${encodeURIComponent('/library/' + book.id)}`}>Sign in</a> to use your saved vocabulary and download the deck.</p>
    {/if}
  </form>
</section>

<style>
  section { border-top: 1px solid var(--rule); padding: 1.5rem 0; }
  h2 { font-size: 1.1rem; margin: 0 0 1rem; }
  p { color: var(--ink-3); font-size: .85rem; line-height: 1.6; margin: 0; }
  form { margin-top: 1rem; display: grid; gap: .8rem; justify-items: start; }
  .settings, .filters { display: flex; flex-wrap: wrap; gap: .75rem; max-width: 100%; }
  label { font-size: .85rem; }
  .settings label { display: grid; gap: .35rem; min-width: 0; }
  select, input[type='number'] { box-sizing: border-box; max-width: 100%; min-height: 2.25rem; background: var(--paper); color: var(--ink); border: 1px solid var(--rule); border-radius: 5px; padding: .4rem .55rem; font: inherit; }
  .filters label { display: inline-flex; align-items: center; gap: .35rem; }
  input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
