<script lang="ts">
  import { page } from '$app/state';
  import { hindiReviewHref } from '$lib/dictionary/hindi-review-link';
  import Button from '$lib/components/input/Button.svelte';
  import PageLayout from '$lib/components/shell/PageLayout.svelte';
  import PageTitle from '$lib/components/shell/PageTitle.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const isAdmin = $derived(data.moderator.role === 'admin');
  const canReviewHindi = $derived(data.moderator.grantedLanguages.includes('hi'));
</script>

<svelte:head>
  <title>Moderation | Parhiba</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#snippet heading()}<PageTitle>Moderation</PageTitle>{/snippet}

{#snippet tool(href: string, label: string)}
  <li><Button {href}><span>{label}</span><span class="chevron" aria-hidden="true">›</span></Button></li>
{/snippet}

<PageLayout {heading}>
  {@render heading()}
  <div class="moderation">
    {#if isAdmin}
      <nav class="tabs" aria-label="Moderation sections">
        <Button href="/moderation" aria-current={!data.activity ? 'page' : undefined}>Language tools</Button>
        <Button href="/moderation?tab=site" aria-current={data.activity ? 'page' : undefined}>Site</Button>
      </nav>
    {/if}
    {#if data.activity}
      <h2>Accounts</h2>
      <ul class="tools">{@render tool('/moderation/users', 'Users')}</ul>
      <h2>Last 24 hours</h2>
      <dl>
        <div><dt>New signups</dt><dd>{data.activity.signups}</dd></div>
        <div><dt>New signups still unverified</dt><dd>{data.activity.unverifiedSignups}</dd></div>
        <div><dt>Email attempts / limit</dt><dd>{data.activity.emailAttempts} / {data.activity.emailLimit}</dd></div>
        <div><dt>Unverified email attempts / limit</dt><dd>{data.activity.unverifiedAttempts} / {data.activity.unverifiedLimit}</dd></div>
      </dl>
    {:else}
      <h2>Dictionaries</h2>
      <ul class="tools">
        {@render tool('/dictionary', 'Open dictionary')}
        {#if canReviewHindi}
          {@render tool('/dictionary/hi?view=review', 'Hindi dictionary workshop')}
          {@render tool(hindiReviewHref(page.url), 'Hindi unparsed words and context review')}
        {/if}
        {@render tool('/moderation/transcribe', 'Transcribe dictionary scans')}
        {#if isAdmin}
          {@render tool('/moderation/dictionary/bulk', 'Bulk dictionary tools')}
          {@render tool('/moderation/dictionary/sources', 'Dictionary sources')}
          {@render tool('/moderation/paradigms', 'Paradigms')}
        {/if}
      </ul>
      <h2>Review</h2>
      <ul class="tools">
        {@render tool('/moderation/translations', 'Translation reports')}
        {@render tool('/moderation/parses', 'Parse reports')}
        {@render tool('/moderation/phrases', 'Phrases')}
        {#if isAdmin}{@render tool('/moderation/stats', 'Correction statistics')}{/if}
      </ul>
    {/if}
  </div>
</PageLayout>

<style>
  .moderation { max-width: 54rem; }
  .tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--rule); }
  .tabs :global(a) {
    min-height: 2.75rem;
    border: 0;
    border-bottom: 3px solid transparent;
    border-radius: 0;
    background: transparent;
    font-size: 1rem;
  }
  .tabs :global([aria-current]) { border-bottom-color: var(--accent); font-weight: 650; }
  h2 { margin: 1.5rem 0 0.6rem; font-size: 1.1rem; }
  .tools, dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: 0.5rem;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .tools :global(a) {
    display: flex;
    justify-content: space-between;
    min-height: 3rem;
    padding: 0.6rem 1rem;
    font-size: 1rem;
  }
  .chevron { color: var(--ink-2); font-size: 1.25rem; }
  dl { grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
  dl div { padding: 0.8rem 1rem; border-block-start: 1px solid var(--rule); }
  dt { color: var(--ink-2); }
  dd { margin: 0.25rem 0 0; font-size: 1.5rem; font-variant-numeric: tabular-nums; }
</style>
