<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import Button from '$lib/components/input/Button.svelte';
  import { dictionaryProfile } from '$lib/dictionary/profiles';
  import PageLayout from '$lib/components/shell/PageLayout.svelte';
  import PageTitle from '$lib/components/shell/PageTitle.svelte';
  import Workshop from '$lib/components/dictionary/Workshop.svelte';
  import PublicDictionary from './PublicDictionary.svelte';
  import '$lib/styles/dictionary-workshop.css';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let workshop: Workshop | undefined = $state();
  let retained = $state.raw<NonNullable<PageProps['data']['staff']> | null>(null);
  const editor = $derived(data.staff ?? (data.canEdit && retained?.language.code === data.language.code ? retained : null));
  const reviewHref = $derived(data.staff && dictionaryProfile(data.language.code).reviewHref?.(
    page.url, workshop?.selectedReviewBook() ?? page.url.searchParams.get('textId') ?? undefined,
  ));

  async function toggleStaff() {
    const url = new URL(page.url);
    let openAfterSwitch: { id: string; query: string } | undefined;
    if (data.staff) {
      // Keep the editor mounted so a preview round trip preserves unsaved drafts.
      retained = data.staff;
      const selection = workshop?.previewSelection();
      if (selection?.id) url.searchParams.set('id', selection.id);
      else url.searchParams.delete('id');
      if (selection?.query) url.searchParams.set('q', selection.query);
      else url.searchParams.delete('q');
      url.searchParams.set('mode', 'public');
    } else {
      url.searchParams.delete('mode');
      const selection = data.entry;
      const previous = workshop?.previewSelection();
      const browsingChanged = url.searchParams.has('id') || data.query?.q !== previous?.query;
      if (selection && browsingChanged && selection.id !== previous?.id) {
        url.searchParams.set('id', selection.id);
        url.searchParams.set('view', 'entries');
        openAfterSwitch = { id: selection.id, query: data.query?.q ?? '' };
      }
    }
    await goto(url, { keepFocus: true, noScroll: true });
    if (openAfterSwitch) {
      await tick();
      await workshop?.showEntry(openAfterSwitch.id, openAfterSwitch.query);
    }
  }
</script>

<svelte:head>
  <title>{data.language.nativeDictionaryTitle} | {data.language.displayName} Dictionary | Parhiba</title>
  <meta name="description" content="Browse {data.language.displayName} dictionary entries and definitions in Parhiba." />
</svelte:head>

{#snippet heading()}
  <PageTitle dir="ltr">
    <bdi lang={data.language.code} dir={data.language.textDirection}>{data.language.nativeDictionaryTitle}</bdi>
    <span aria-hidden="true">|</span>
    <span lang="en">{data.language.displayName} Dictionary</span>
  </PageTitle>
{/snippet}

<PageLayout {heading}>
  <div class="dictionary-workspace">
    <header>
      {@render heading()}
      {#if data.canEdit}
        <div class="actions">
          {#if reviewHref}<Button href={reviewHref}>Book review</Button>{/if}
          {#if data.staff && data.language.code !== 'hi' && workshop?.previewSelection().id}
            <Button href={`/moderation/dictionary/${workshop.previewSelection().id}`}>Manage entry</Button>
          {/if}
          <Button variant="toggle" aria-pressed={!!data.staff} onclick={toggleStaff}>Staff</Button>
        </div>
      {/if}
    </header>
    {#if editor}
      {#key editor.language.code}<Workshop data={editor} visible={!!data.staff} bind:this={workshop} />{/key}
    {/if}
    {#if !data.staff}
      {#key data.language.code}<PublicDictionary {data} />{/key}
    {/if}
    <footer>
      {#if data.language.code === 'hi'}
        The Hindi dictionary includes entries from <a href="https://en.wiktionary.org/wiki/Category:Hindi_language">Wiktionary</a>.
      {/if}
      All dictionary data on Parhiba is released under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license">CC BY-SA 4.0</a>.
    </footer>
  </div>
</PageLayout>

<style>
  header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .actions {
    grid-column: 2;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  footer {
    margin-top: 1.5rem;
    border-top: 1px solid var(--rule);
    padding-top: 0.75rem;
    color: var(--ink-2);
    font-size: 0.875rem;
    line-height: 1.5;
  }
  footer a { color: inherit; }
</style>
