<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let {
    data,
    form,
  }: { data: PageData; form: ActionData } = $props();

  const lemma = $derived(data.lemma);

  const formattedHistory = $derived(
    data.history.map((h) => ({
      ...h,
      when: new Date(h.createdAt).toLocaleString(),
    })),
  );

  function msgFor(section: string): string | null {
    if (!form) return null;
    if (form.section !== section) return null;
    if (form.ok) return 'Saved.';
    return form.message;
  }

  function translationMsg(
    translationId: string,
  ): { ok: boolean; message: string } | null {
    if (!form || form.section !== 'translation') return null;
    if (form.translationId !== translationId) return null;
    return {
      ok: form.ok,
      message: form.ok ? 'Saved.' : form.message,
    };
  }
</script>

<svelte:head>
  <title>Edit {lemma.headword} — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <p class="crumb">
    <a href="/moderation/dictionary?language={lemma.language}">← Back to dictionary</a>
  </p>

  <header>
    <h1>
      <span class="headword">{lemma.headword}</span>
      <span class="pos">{lemma.pos}</span>
      {#if lemma.curatorLocked}<span class="badge">locked</span>{/if}
    </h1>
    <p class="sub">
      {lemma.language} · {lemma.script}
      {#if lemma.sourceAttribution}· {lemma.sourceAttribution}{/if}
    </p>
  </header>

  <!-- Lemma fields ------------------------------------------------------ -->
  <section>
    <h2>Lemma</h2>
    {#if msgFor('lemma')}
      <p class:ok={form?.ok} class:err={!form?.ok}>{msgFor('lemma')}</p>
    {/if}
    <form method="post" action="?/updateLemma" use:enhance>
      <label>
        Headword
        <input name="headword" value={lemma.headword} required />
      </label>
      <label>
        Part of speech
        <input name="pos" value={lemma.pos} required />
      </label>
      <label>
        Default gloss
        <textarea name="glossDefault" rows="2">{lemma.glossDefault ?? ''}</textarea>
      </label>
      <label>
        Frequency rank
        <input
          name="frequencyRank"
          type="number"
          min="0"
          value={lemma.frequencyRank ?? ''}
        />
      </label>
      <label>
        Source attribution
        <input name="sourceAttribution" value={lemma.sourceAttribution ?? ''} />
      </label>
      <label>
        Reason (required)
        <input name="reason" required minlength="3" placeholder="Why are you making this change?" />
      </label>
      <button type="submit">Save lemma</button>
    </form>
  </section>

  <!-- Lock toggle ------------------------------------------------------- -->
  <section>
    <h2>Import protection</h2>
    {#if msgFor('lock')}
      <p class:ok={form?.ok} class:err={!form?.ok}>{msgFor('lock')}</p>
    {/if}
    <p class="sub">
      Locked lemmas are skipped by future dictionary re-imports so your edits
      aren't clobbered.
    </p>
    <form method="post" action="?/setLock" use:enhance class="inline-form">
      <input type="hidden" name="locked" value={lemma.curatorLocked ? 'false' : 'true'} />
      <input name="reason" required minlength="3" placeholder="Reason" />
      <button type="submit">
        {lemma.curatorLocked ? 'Unlock' : 'Lock'}
      </button>
    </form>
  </section>

  <!-- Translations ------------------------------------------------------ -->
  <section>
    <h2>Translations ({data.translations.length})</h2>
    {#if data.translations.length === 0}
      <p class="muted">No translations.</p>
    {:else}
      <ul class="translations">
        {#each data.translations as t (t.id)}
          <li>
            <div class="meta">
              <span class="tag">{t.source}</span>
              <span class="muted">{t.targetLanguage}</span>
              {#if t.hidden}<span class="tag warn">hidden</span>{/if}
            </div>
            {#if translationMsg(t.id)}
              {@const tm = translationMsg(t.id)!}
              <p class:ok={tm.ok} class:err={!tm.ok}>{tm.message}</p>
            {/if}
            <form method="post" action="?/updateTranslation" use:enhance class="stack">
              <input type="hidden" name="translationId" value={t.id} />
              <label>
                Body
                <textarea name="body" rows="2" required>{t.body}</textarea>
              </label>
              {#if t.source === 'user'}
                <label class="checkbox">
                  <input type="checkbox" name="promoteToCurator" value="true" />
                  Promote to curator (official)
                </label>
              {/if}
              <label>
                Reason
                <input name="reason" required minlength="3" placeholder="Reason" />
              </label>
              <div class="row-actions">
                <button type="submit">Save</button>
                {#if t.source === 'user'}
                  <button
                    type="submit"
                    formaction="?/setTranslationHidden"
                    name="hidden"
                    value={t.hidden ? 'false' : 'true'}
                    class="secondary"
                  >
                    {t.hidden ? 'Unhide' : 'Hide'}
                  </button>
                {/if}
              </div>
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Merge ------------------------------------------------------------- -->
  <section>
    <h2>Merge</h2>
    {#if msgFor('merge')}
      <p class:ok={form?.ok} class:err={!form?.ok}>{msgFor('merge')}</p>
    {/if}
    <p class="sub">
      Rewires translations + forms from the loser lemma into this one, then
      deletes the loser. Cross-language merges are rejected.
    </p>
    <form method="post" action="?/merge" use:enhance class="stack">
      <label>
        Loser lemma id
        <input name="loserId" required placeholder="uuid of the duplicate lemma" />
      </label>
      <label>
        Reason
        <input name="reason" required minlength="3" placeholder="e.g. duplicate import" />
      </label>
      <button type="submit" class="danger">Merge into this lemma</button>
    </form>
  </section>

  <!-- Split ------------------------------------------------------------- -->
  <section>
    <h2>Split</h2>
    {#if msgFor('split')}
      <p class:ok={form?.ok} class:err={!form?.ok}>
        {msgFor('split')}
        {#if form?.ok && form.section === 'split'}
          <a href={`/moderation/dictionary/${form.newLemmaId}`}>Open new lemma →</a>
        {/if}
      </p>
    {/if}
    <p class="sub">
      Creates a new curator-owned lemma and moves the selected translations
      onto it.
    </p>
    <form method="post" action="?/split" use:enhance class="stack">
      <label>
        New headword
        <input name="newHeadword" required />
      </label>
      <label>
        New part of speech
        <input name="newPos" required />
      </label>
      <label>
        New gloss (optional)
        <input name="newGloss" />
      </label>
      <label>
        Translation ids to move (comma- or space-separated)
        <textarea name="translationIds" rows="2"></textarea>
      </label>
      <label>
        Reason
        <input name="reason" required minlength="3" />
      </label>
      <button type="submit" class="danger">Split off new lemma</button>
    </form>
  </section>

  <!-- History ---------------------------------------------------------- -->
  <section>
    <h2>Recent edits</h2>
    {#if formattedHistory.length === 0}
      <p class="muted">No audit rows yet.</p>
    {:else}
      <ol class="history">
        {#each formattedHistory as h (h.id)}
          <li>
            <span class="tag">{h.changeType}</span>
            <span class="muted">{h.when}</span>
            <div>{h.reason}</div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 42rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  .crumb {
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .crumb a {
    color: var(--color-accent);
  }
  header h1 {
    margin: 0 0 0.25rem;
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .headword {
    font-size: 1.6rem;
  }
  .pos {
    font-size: 0.85rem;
    color: var(--color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge,
  .tag {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--color-border);
    color: var(--color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tag.warn {
    background: color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: var(--color-fg);
  }
  .sub {
    color: var(--color-fg-muted);
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .muted {
    color: var(--color-fg-muted);
  }
  section {
    margin: 1.75rem 0;
    padding: 1rem 1.25rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
  }
  section h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  form label {
    display: block;
    margin-bottom: 0.75rem;
    font-size: 0.9rem;
  }
  form input,
  form textarea {
    display: block;
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem 0.6rem;
    font: inherit;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    min-height: 44px;
  }
  form textarea {
    min-height: 3rem;
    resize: vertical;
  }
  .stack > * {
    margin-bottom: 0.75rem;
  }
  .inline-form {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .inline-form input[name='reason'] {
    min-height: 44px;
    margin-top: 0;
    flex: 1;
  }
  form button {
    min-height: 44px;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  form button.secondary {
    background: transparent;
    color: var(--color-fg);
    border: 1px solid var(--color-border);
  }
  form button.danger {
    background: #b03131;
    color: #fff;
  }
  .row-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .translations {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .translations li {
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  .translations li:last-child {
    border-bottom: 0;
  }
  .meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .history {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 0.9rem;
  }
  .history li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  .history li:last-child {
    border-bottom: 0;
  }
  .ok {
    color: #197a2f;
  }
  .err {
    color: #b03131;
  }
  .checkbox {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .checkbox input {
    display: inline;
    width: auto;
    min-height: 0;
    margin: 0;
  }
</style>
