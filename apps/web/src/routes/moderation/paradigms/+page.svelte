<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let {
    data,
    form,
  }: { data: PageData; form: ActionData } = $props();

  const createResult = $derived(form?.section === 'create' ? form : null);

  function hrefWith(params: { language?: string | null; pos?: string | null }): string {
    const sp = new URLSearchParams();
    if (params.language) sp.set('language', params.language);
    if (params.pos) sp.set('pos', params.pos);
    const qs = sp.toString();
    return qs ? `?${qs}` : '';
  }
</script>

<svelte:head>
  <title>Paradigms — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <p class="crumb">
    <a href="/moderation/dictionary">← Back to dictionary</a>
  </p>

  <header>
    <h1>Paradigms</h1>
    <p class="sub">
      Admin-only. A paradigm is a conjugation/declension pattern (e.g. "Odia
      regular verb"); each row pairs a (language, pos) scope with a list of
      slot suffixes the form generator appends to a lemma's <code>stem</code>.
    </p>
  </header>

  <section>
    <h2>Filter</h2>
    <form method="get" class="filter">
      <label>
        Language
        <select name="language">
          <option value="">All languages</option>
          {#each data.languages as l (l.code)}
            <option value={l.code} selected={data.filter.language === l.code}>
              {l.displayName} ({l.nativeName})
            </option>
          {/each}
        </select>
      </label>
      <label>
        POS
        <input
          name="pos"
          value={data.filter.pos ?? ''}
          placeholder="e.g. VERB"
        />
      </label>
      <div class="filter-actions">
        <button type="submit">Apply</button>
        {#if data.filter.language || data.filter.pos}
          <a class="reset" href={hrefWith({})}>Reset</a>
        {/if}
      </div>
    </form>
  </section>

  <section>
    <h2>Paradigms ({data.paradigms.length})</h2>
    {#if data.paradigms.length === 0}
      <p class="empty">No paradigms match the current filter.</p>
    {:else}
      <ul class="paradigm-list">
        {#each data.paradigms as p (p.id)}
          <li>
            <a class="row" href={`/moderation/paradigms/${p.id}`}>
              <span class="lang-badge">{p.language}</span>
              <span class="pos-badge">{p.pos}</span>
              <span class="name">{p.name}</span>
            </a>
            {#if p.description}
              <div class="desc">{p.description}</div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2>Create a paradigm</h2>
    <p class="sub">
      The new paradigm starts with no slots. Open the detail page after
      creating it to add infinitive, person/number, tense slots etc.
    </p>

    {#if createResult}
      {#if createResult.ok}
        <p class="ok">
          Created. <a href={`/moderation/paradigms/${createResult.paradigmId}`}
            >Open editor →</a
          >
        </p>
      {:else}
        <p class="err">{createResult.message}</p>
      {/if}
    {/if}

    <form method="post" action="?/create" use:enhance class="stack">
      <label>
        Language
        <select name="language" required>
          {#each data.languages as l (l.code)}
            <option value={l.code}>{l.displayName} ({l.nativeName})</option>
          {/each}
        </select>
      </label>
      <label>
        POS
        <input name="pos" placeholder="VERB" required maxlength="32" />
      </label>
      <label>
        Name
        <input
          name="name"
          placeholder="e.g. Hindi regular verb"
          required
          maxlength="128"
        />
      </label>
      <label>
        Description (optional)
        <textarea name="description" rows="3" maxlength="1000"></textarea>
      </label>
      <button type="submit">Create paradigm</button>
    </form>
  </section>
</div>

<style>
  .page {
    max-width: 48rem;
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
    font-size: 1.6rem;
  }
  .sub {
    margin: 0 0 0.75rem;
    color: var(--color-fg-muted);
    font-size: 0.9rem;
  }
  section {
    margin: 1.75rem 0;
    padding: 1rem 1.25rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
  }
  section h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .filter {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    align-items: end;
  }
  .filter label {
    display: block;
    font-size: 0.85rem;
  }
  .filter input,
  .filter select {
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
  .filter-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .filter-actions button {
    min-height: 44px;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .reset {
    font-size: 0.85rem;
    color: var(--color-fg-muted);
  }
  .paradigm-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .paradigm-list li {
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    text-decoration: none;
    color: var(--color-fg);
  }
  .row:hover .name {
    text-decoration: underline;
  }
  .lang-badge,
  .pos-badge {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--color-border);
    color: var(--color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .name {
    font-weight: 500;
  }
  .desc {
    margin-top: 0.25rem;
    color: var(--color-fg-muted);
    font-size: 0.85rem;
  }
  .empty {
    margin: 0.5rem 0;
    color: var(--color-fg-muted);
  }
  form.stack > * {
    margin-bottom: 0.75rem;
  }
  form label {
    display: block;
    font-size: 0.9rem;
  }
  form input,
  form textarea,
  form select {
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
    min-height: 5rem;
    resize: vertical;
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
  .ok {
    color: #197a2f;
  }
  .err {
    color: #b03131;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
  }
</style>
