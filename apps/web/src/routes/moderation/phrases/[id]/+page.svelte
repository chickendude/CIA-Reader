<!--
  Curator phrase editor detail page (T-14.4a). Read-only view of
  every translation (including hidden) + chapter occurrences +
  recent audit history, plus an inline form for editing the
  phrase's gloss / pos / frequency / source attribution.
-->
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // T-14.4a: form fields are intentionally local to the editor —
  // `data` arrives once from the page-server loader and the user
  // edits in place. The `state_referenced_locally` warnings are
  // suppressed because the capture-once semantics are correct for
  // a form (the loader's data is the canonical "before" state;
  // edits live in the drafts until Save POSTs them).
  // svelte-ignore state_referenced_locally
  let glossDraft = $state(data.phrase.glossDefault ?? '');
  // svelte-ignore state_referenced_locally
  let posDraft = $state(data.phrase.pos ?? '');
  // svelte-ignore state_referenced_locally
  let frequencyDraft = $state<number | null>(data.phrase.frequencyRank);
  // svelte-ignore state_referenced_locally
  let sourceAttributionDraft = $state(data.phrase.sourceAttribution ?? '');
  let reasonDraft = $state('');
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let savedFlash = $state(false);

  async function save(event: Event) {
    event.preventDefault();
    if (reasonDraft.trim().length < 3) {
      saveError = 'Reason is required (≥3 characters).';
      return;
    }
    saving = true;
    saveError = null;
    savedFlash = false;
    try {
      const res = await fetch(`/api/v1/admin/phrases/${data.phrase.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          glossDefault: glossDraft.trim() || null,
          pos: posDraft.trim() || null,
          frequencyRank:
            typeof frequencyDraft === 'number' && Number.isFinite(frequencyDraft)
              ? frequencyDraft
              : null,
          sourceAttribution: sourceAttributionDraft.trim() || null,
          reason: reasonDraft.trim(),
        }),
      });
      if (res.ok) {
        savedFlash = true;
        reasonDraft = '';
        // The page-server loader is the source of truth — let the user
        // refresh to see audit + translation changes. Inline state
        // for the editable fields stays as-is so the form doesn't
        // jump under the user's hands.
      } else {
        const body = await res.text().catch(() => '');
        saveError = body || `Could not save (${res.status})`;
      }
    } catch (e) {
      saveError = `Network error: ${(e as Error).message}`;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>{data.phrase.surfaceNormalised} — phrase editor</title>
</svelte:head>

<div class="pe">
  <header class="pe-h">
    <a class="back" href={`/moderation/phrases?language=${data.languageDescriptor.code}`}>← All phrases</a>
    <h1 class="pe-surface">{data.phrase.surfaceNormalised}</h1>
    <p class="muted">
      {data.languageDescriptor.displayName} · {data.phrase.tokens.length} tokens · {data.translations.length} translations
      · {data.chapterIds.length} chapters
    </p>
    <p class="muted small">
      Source: {data.phrase.source}
      {#if data.phrase.curatorLocked}<span class="flag" data-flag="locked">curator-locked</span>{/if}
      {#if data.phrase.hidden}<span class="flag" data-flag="hidden">hidden</span>{/if}
    </p>
  </header>

  <section class="pe-section">
    <h2>Tokens</h2>
    <ol class="pe-tokens" data-testid="phrase-tokens">
      {#each data.phrase.tokens as t (t.position)}
        <li>
          <span class="pos">#{t.position}</span>
          <span class="surface">{t.surface}</span>
          {#if t.lemmaId}
            <a class="link" href={`/dictionary/${data.languageDescriptor.code}/lemmas/${t.lemmaId}`}>component lemma</a>
          {/if}
        </li>
      {/each}
    </ol>
  </section>

  <section class="pe-section pe-edit" data-testid="phrase-editor-form">
    <h2>Edit</h2>
    <form onsubmit={save}>
      <label class="row">
        <span>Gloss</span>
        <input type="text" bind:value={glossDraft} maxlength="500" />
      </label>
      <label class="row">
        <span>Part of speech</span>
        <input type="text" bind:value={posDraft} maxlength="32" placeholder="e.g. VERB" />
      </label>
      <label class="row">
        <span>Frequency rank</span>
        <input type="number" min="0" bind:value={frequencyDraft} />
      </label>
      <label class="row">
        <span>Source attribution</span>
        <input type="text" bind:value={sourceAttributionDraft} maxlength="200" />
      </label>
      <label class="row">
        <span>Reason (≥3 chars)</span>
        <input type="text" bind:value={reasonDraft} placeholder="Required curator-edit reason" />
      </label>
      <div class="actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {#if saveError}<span class="err small">{saveError}</span>{/if}
        {#if savedFlash}<span class="ok small">Saved.</span>{/if}
      </div>
    </form>
  </section>

  <section class="pe-section">
    <h2>Translations <span class="muted small">({data.translations.length})</span></h2>
    {#if data.translations.length === 0}
      <p class="muted">No translations attached to this phrase yet.</p>
    {:else}
      <ul class="pe-trans">
        {#each data.translations as t (t.id)}
          <li class:hidden={t.hidden}>
            <span class="pe-trans-body">{t.body}</span>
            <span class="pe-trans-source small muted">{t.source}</span>
            {#if t.hidden}<span class="flag" data-flag="hidden">hidden</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="pe-section">
    <h2>Audit history <span class="muted small">({data.history.length})</span></h2>
    {#if data.history.length === 0}
      <p class="muted">No edits recorded yet.</p>
    {:else}
      <ol class="pe-hist" data-testid="phrase-history">
        {#each data.history as h (h.id)}
          <li>
            <span class="changeType">{h.changeType}</span>
            <span class="muted small">— {h.reason}</span>
            <span class="muted small ts">{new Date(h.createdAt).toISOString().slice(0, 10)}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>

<style>
  .pe {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    color: var(--ink, var(--color-fg));
  }
  .back {
    color: var(--ink-3, var(--color-fg-muted));
    text-decoration: none;
    font-size: 0.85rem;
  }
  .back:hover {
    text-decoration: underline;
  }
  .pe-surface {
    margin: 0.25rem 0 0.4rem;
    font-family: var(--font-serif);
    font-size: 1.6rem;
  }
  .muted {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .small {
    font-size: 0.8rem;
  }
  .pe-section {
    margin: 1.5rem 0;
  }
  .pe-section h2 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0 0 0.55rem;
  }
  .pe-tokens {
    margin: 0;
    padding-left: 1.2rem;
  }
  .pe-tokens li {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    padding: 0.15rem 0;
  }
  .pe-tokens .pos {
    font-family: var(--font-mono-display, var(--font-mono));
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
  }
  .pe-tokens .surface {
    font-weight: 500;
  }
  .row {
    display: grid;
    grid-template-columns: 12rem 1fr;
    gap: 0.5rem;
    margin: 0.4rem 0;
    align-items: center;
  }
  .row span {
    font-size: 0.8rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .row input {
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    background: var(--bg, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font: inherit;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
  .actions button {
    padding: 0.35rem 0.85rem;
    border-radius: 6px;
    border: 1px solid var(--rule, var(--color-border));
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    cursor: pointer;
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ok {
    color: oklch(45% 0.18 145);
  }
  .err {
    color: oklch(45% 0.18 25);
  }
  .pe-trans {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pe-trans li {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    padding: 0.3rem 0;
    border-bottom: 1px dashed var(--rule, var(--color-border));
  }
  .pe-trans li.hidden {
    opacity: 0.55;
  }
  .pe-trans-body {
    flex: 1;
  }
  .pe-hist {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pe-hist li {
    display: flex;
    gap: 0.55rem;
    padding: 0.25rem 0;
    border-bottom: 1px dashed var(--rule, var(--color-border));
  }
  .changeType {
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
  }
  .ts {
    margin-left: auto;
  }
  .flag {
    display: inline-block;
    margin: 0 0.3rem;
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    border: 1px solid var(--rule, var(--color-border));
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .flag[data-flag='locked'] {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .flag[data-flag='hidden'] {
    background: color-mix(in srgb, oklch(60% 0.18 25) 12%, transparent);
  }
  .link {
    color: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
  }
</style>
