<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  import { untrack } from 'svelte';
  let { data }: { data: PageData } = $props();

  let title = $state('');
  let language = $state(untrack(() => data.languages[0]?.code ?? 'hi'));
  let kind = $state<'chapter_book' | 'course' | 'anthology'>('chapter_book');
  let description = $state('');
  let coverUrl = $state('');
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (!title.trim()) {
      saveError = 'Title is required';
      return;
    }
    saving = true;
    saveError = null;
    try {
      const res = await fetch('/api/v1/collections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          language,
          kind,
          description: description.trim() || null,
          coverUrl: coverUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        saveError = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
        return;
      }
      const data = (await res.json()) as { collection: { id: string } };
      void goto(`/collections/${data.collection.id}`);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>New collection — CIA Reader</title>
</svelte:head>

<div class="nc">
  <header><h1>New collection</h1></header>
  <form onsubmit={submit} class="nc-form">
    <label class="nc-row">
      <span class="nc-l">Title</span>
      <input id="nc-title" type="text" bind:value={title} maxlength="200" required />
    </label>
    <div class="nc-grid">
      <label class="nc-row">
        <span class="nc-l">Language</span>
        <select id="nc-lang" bind:value={language}>
          {#each data.languages as lang}
            <option value={lang.code}>{lang.displayName}</option>
          {/each}
        </select>
      </label>
      <label class="nc-row">
        <span class="nc-l">Kind</span>
        <select id="nc-kind" bind:value={kind}>
          <option value="chapter_book">Chapter book</option>
          <option value="course">Course</option>
          <option value="anthology">Anthology</option>
        </select>
      </label>
    </div>
    <label class="nc-row">
      <span class="nc-l">Description (optional)</span>
      <textarea id="nc-desc" bind:value={description} maxlength="2000" rows="3"></textarea>
    </label>
    <label class="nc-row">
      <span class="nc-l">Cover image URL (optional)</span>
      <input id="nc-cover" type="url" bind:value={coverUrl} maxlength="500" />
    </label>
    {#if saveError}
      <p class="nc-err" role="alert">{saveError}</p>
    {/if}
    <footer class="nc-foot">
      <button type="button" onclick={() => goto('/library')}>Cancel</button>
      <button type="submit" class="nc-submit" disabled={saving || !title.trim()}>
        {saving ? 'Creating…' : 'Create collection'}
      </button>
    </footer>
  </form>
</div>

<style>
  .nc {
    max-width: 36rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    color: var(--ink, var(--color-fg));
  }
  .nc h1 {
    margin: 0 0 1rem;
    font-family: var(--font-serif, system-ui);
  }
  .nc-form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .nc-row {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .nc-l {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    font-weight: 500;
  }
  .nc-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.85rem;
  }
  input,
  select,
  textarea {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font: inherit;
    font-size: 0.9rem;
  }
  .nc-foot {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }
  .nc-foot button {
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    padding: 0.4rem 0.85rem;
    font: inherit;
    cursor: pointer;
    color: var(--ink, var(--color-fg));
  }
  .nc-submit {
    background: var(--accent, var(--color-accent)) !important;
    color: var(--accent-ink, var(--color-bg)) !important;
    border-color: var(--accent, var(--color-accent)) !important;
  }
  .nc-submit:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .nc-err {
    color: var(--err, #b94545);
    font-size: 0.82rem;
    margin: 0;
  }
</style>
