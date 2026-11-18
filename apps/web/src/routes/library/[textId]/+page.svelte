<script lang="ts">
  import { enhance } from '$app/forms';
  import { coverForId } from '$lib/components/library/cover.js';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let importing = $state(false);
  let scope = $state('unknown');
  const book = $derived(data.book);
  const deckUrl = $derived(`/api/v1/texts/${book.id}/anki?scope=${scope}`);
</script>

<svelte:head><title>{book.title} | Official | Parhiba</title></svelte:head>

<div class="book-page">
  <a class="back" href="/library?tab=official">← Official library</a>
  <div class="book-layout">
    <div class={`book-cover cover-${coverForId(book.id)}`}><span>{book.title}</span><small>{book.language.toUpperCase()} · OFFICIAL</small></div>
    <div class="book-info">
      <p class="eyebrow">Official library · {book.language}</p>
      <h1 class="page-title">{book.title}</h1>
      <div class="facts">
        <div><strong>{book.words.toLocaleString()}</strong><span>Words</span></div>
        <div><strong>{book.uniqueWords.toLocaleString()}</strong><span>Dictionary entries</span></div>
        <div><strong>{book.unresolved.toLocaleString()}</strong><span>Unresolved words</span></div>
      </div>
      <section class="coverage" aria-label="Your vocabulary coverage">
        <h2>Your coverage</h2>
        {#if data.isAuthenticated && book.knownPct !== null}
          <div class="coverage-label"><strong>{book.knownPct}% known</strong><span>{book.learningPct}% known + learning</span></div>
          <div class="coverage-bar" role="meter" aria-label="Known vocabulary coverage" aria-valuenow={book.knownPct} aria-valuemin="0" aria-valuemax="100">
            <span class="learning" style:width={`${book.learningPct}%`}></span><span class="known" style:width={`${book.knownPct}%`}></span>
          </div>
          <p>Based on dictionary occurrences, including every supported alternative. Unresolved words count toward the total.</p>
        {:else if data.isAuthenticated}<p>Coverage will appear when analysis is ready.</p>
        {:else}<p><a href={`/login?next=${encodeURIComponent(`/library/${book.id}`)}`}>Sign in</a> to see your coverage.</p>{/if}
        {#if book.analysisStale}<p>Dictionary changes are pending reanalysis. Coverage uses the last saved analysis.</p>{/if}
      </section>
      <section class="deck" aria-label="Anki deck">
        <h2>Study this book’s vocabulary</h2>
        <p>Dictionary definitions and book frequencies, ordered from most frequent to least frequent.</p>
        {#if data.isAuthenticated}
          <div class="actions">
            <label>Include <select bind:value={scope}><option value="unknown">Unseen words</option><option value="learning">Learning words</option><option value="all">All vocabulary</option></select></label>
            <a class="btn" href={deckUrl} download>Download Anki deck</a>
          </div>
        {:else}<p>Sign in to download a vocabulary deck.</p>{/if}
      </section>
      <div class="reading">
        {#if data.isStaff}
          {#if book.language === 'hi'}<a class="btn" href={`/moderation/hindi?textId=${book.id}`}>Review dictionary matches</a>{/if}
          <a class="btn" href={`/reader/${book.id}`}>Read book</a>
          {#if book.personalTextId}<a class="btn" href={`/reader/${book.personalTextId}`}>Open in my library</a>
          {:else}<form method="POST" action="?/import" use:enhance={() => {
            importing = true;
            return async ({ update }) => { try { await update(); } finally { importing = false; } };
          }}><button class="btn" disabled={importing}>{importing ? 'Importing…' : 'Import to my library'}</button></form>{/if}
        {:else if !book.staffOnly}<a class="btn" href={`/reader/${book.id}`}>Read book</a>
        {:else}<p>Reading and importing the full book are available to staff.</p>{/if}
      </div>
      {#if form?.message}<p role="alert">{form.message}</p>{/if}
    </div>
  </div>
</div>

<style>
  .back { color: var(--ink-3); font-size: .9rem; }
  .book-layout { display: grid; grid-template-columns: 240px 1fr; gap: 2.5rem; margin-top: 2rem; }
  .book-cover { min-height: 330px; align-self: start; padding: 2rem; border-radius: 10px; background: var(--accent); color: var(--accent-ink,white); display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 8px 24px #0002; }
  .book-cover span { font-family: var(--font-serif); font-size: 2rem; line-height: 1.3; }
  .book-cover small { letter-spacing: .12em; font-size: .7rem; }
  .eyebrow { color: var(--ink-3); margin: 0; font-size: .8rem; }

  h2 { font-size: 1.1rem; margin: 0 0 1rem; }
  .facts { display: flex; flex-wrap: wrap; gap: 1.5rem; margin-bottom: 2rem; }
  .facts div { display: grid; gap: .2rem; }
  .facts strong { font-size: 1.4rem; }
  .facts span, section p, .reading p { color: var(--ink-3); font-size: .85rem; line-height: 1.6; }
  section { border-top: 1px solid var(--rule); padding: 1.5rem 0; }
  .coverage-label { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .5rem; font-size: .9rem; }
  .coverage-bar { position: relative; height: 12px; border-radius: 6px; overflow: hidden; background: var(--rule); margin: .8rem 0; }
  .coverage-bar span { position: absolute; inset: 0 auto 0 0; }
  .known { background: var(--accent); }
  .learning { background: color-mix(in srgb,var(--accent) 40%,var(--paper)); }
  .actions, .reading { display: flex; align-items: center; flex-wrap: wrap; gap: .75rem; }
  label { display: flex; gap: .5rem; align-items: center; font-size: .85rem; }
  select { background: var(--paper); color: var(--ink); border: 1px solid var(--rule); border-radius: 5px; padding: .55rem; }
  .btn { display: inline-block; padding: .6rem .85rem; border: 1px solid var(--rule); border-radius: 6px; background: var(--card); color: var(--ink); text-decoration: none; font: inherit; font-size: .85rem; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  @media(max-width: 700px) {  .book-layout { grid-template-columns: 1fr; gap: 1.5rem; } .book-cover { min-height: 180px; } }
</style>
