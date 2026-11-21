<script lang="ts">
  import { hindiReviewHref } from '$lib/dictionary/hindi-review-link';
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
  import BookMetrics from '$lib/components/library/BookMetrics.svelte';
  import ReanalysisNotice from '$lib/components/library/ReanalysisNotice.svelte';
  import SubpageHeading from '$lib/components/shell/SubpageHeading.svelte';
  import BookStudyDeck from './BookStudyDeck.svelte';
  import BookComparison from './BookComparison.svelte';
  import { coverForId } from '$lib/components/library/cover.js';
  import type { PageProps } from './$types';
  let { data, form }: PageProps = $props();
  let importing = $state(false);
  const book = $derived(data.book);
</script>

<svelte:head><title>{book.title} | Official | Parhiba</title></svelte:head>

<div class="book-page">
  <div class="book-header">
    <SubpageHeading title={book.title} href="/library?tab=official" closeLabel="Back to official library" />
    <BookComparison comparison={data.comparison} title={book.title} />
  </div>
  <div class="book-layout">
    <div class={`book-cover cover-${coverForId(book.id)}`}><span>{book.title}</span></div>
    <div class="book-info">
      <section class="coverage" aria-label="Book statistics">
        <BookMetrics stats={book.words ? book : null} signedIn={data.isAuthenticated}
          loginHref={`/login?next=${encodeURIComponent('/library/' + book.id)}`} />
        {#if data.isStaff && book.analysisStale}<ReanalysisNotice />{/if}
      </section>
      {#key book.id}
        <BookStudyDeck {book} bands={data.deckBands} signedIn={data.isAuthenticated} />
      {/key}
      <div class="reading">
        {#if data.isStaff}
          {#if book.language === 'hi'}<a class="btn" href={hindiReviewHref(page.url, book.id)}>Review dictionary matches</a>{/if}
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
  .book-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: .75rem; margin-bottom: 1rem; }
  .book-header :global(header) { margin-bottom: 0; }
  .book-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 2.5rem; }
  .book-cover { min-height: 330px; align-self: start; padding: 2rem; border-radius: 10px; background: var(--accent); color: var(--accent-ink,white); display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 8px 24px #0002; }
  .book-cover span { font-family: var(--font-serif); font-size: 2rem; line-height: 1.3; }

  .coverage { border-top: 1px solid var(--rule); padding: .5rem 0 1.5rem; }
  .coverage :global(.metrics) { max-width: 32rem; }
  .reading p { color: var(--ink-3); font-size: .85rem; line-height: 1.6; }
  .reading { display: flex; align-items: center; flex-wrap: wrap; gap: .75rem; }
  .btn { display: inline-block; padding: .6rem .85rem; border: 1px solid var(--rule); border-radius: 6px; background: var(--card); color: var(--ink); text-decoration: none; font: inherit; font-size: .85rem; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  @media(max-width: 700px) {  .book-layout { grid-template-columns: 1fr; gap: 1.5rem; } .book-cover { min-height: 180px; } }
</style>
