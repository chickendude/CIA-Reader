<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let {
    data,
    form,
  }: { data: PageData; form: ActionData } = $props();

  const importResult = $derived(form?.section === 'import' ? form : null);
  const promoteResult = $derived(form?.section === 'promote' ? form : null);
  const attributionResult = $derived(
    form?.section === 'attribution' ? form : null,
  );
</script>

<svelte:head>
  <title>Bulk dictionary tools — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <p class="crumb">
    <a href="/moderation/dictionary">← Back to dictionary</a>
  </p>

  <header>
    <h1>Bulk curator tools</h1>
    <p class="sub">
      Admin-only. Each operation requires a reason and writes one audit row
      per affected translation. Hard cap of {data.bulkLimit} rows per submission.
    </p>
  </header>

  <!-- 1. CSV import ----------------------------------------------------- -->
  <section>
    <h2>Bulk import curator translations</h2>
    <p class="sub">
      Paste tab- or comma-separated rows. Each row resolves an existing lemma
      by <code>(language, headword, pos)</code>; rows that don't match a known
      lemma are listed as skipped — fix them in the dictionary editor first.
    </p>
    <p class="sub">
      Columns:
      <code>language, headword, pos, body[, targetLanguage, sourceAttribution]</code>.
      Lines starting with <code>#</code> are treated as comments.
    </p>

    {#if importResult}
      {#if importResult.ok}
        <p class="ok">
          Inserted {importResult.inserted}.
          {#if importResult.skipped.length > 0}
            Skipped {importResult.skipped.length}:
          {/if}
        </p>
        {#if importResult.skipped.length > 0}
          <ul class="skip-list">
            {#each importResult.skipped as s (s.row)}
              <li>row {s.row}: {s.reason}</li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="err">{importResult.message}</p>
      {/if}
    {/if}

    <form method="post" action="?/import" use:enhance class="stack">
      <label>
        CSV / TSV rows
        <textarea
          name="csv"
          rows="8"
          placeholder="hi, बोलना, verb, to speak, en, My CSV 2026"
          required
        ></textarea>
      </label>
      <label>
        Default attribution (optional — used when a row omits it)
        <input name="defaultAttribution" placeholder="e.g. CIA Reader curators" />
      </label>
      <label>
        Reason
        <input name="reason" required minlength="3" placeholder="Why this import?" />
      </label>
      <button type="submit">Import rows</button>
    </form>
  </section>

  <!-- 2. Bulk promote --------------------------------------------------- -->
  <section>
    <h2>Bulk promote community translations</h2>
    <p class="sub">
      Paste a list of translation IDs (one per line, or comma-separated). Each
      <code>source='user'</code> row will be re-tagged as <code>curator</code>.
      Officials and already-curator rows are skipped without error.
    </p>

    {#if promoteResult}
      {#if promoteResult.ok}
        <p class="ok">
          Promoted {promoteResult.promoted}.
          {#if promoteResult.skipped.length > 0}
            Skipped {promoteResult.skipped.length}:
          {/if}
        </p>
        {#if promoteResult.skipped.length > 0}
          <ul class="skip-list">
            {#each promoteResult.skipped as s (s.id)}
              <li><code>{s.id}</code>: {s.reason}</li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="err">{promoteResult.message}</p>
      {/if}
    {/if}

    <form method="post" action="?/promote" use:enhance class="stack">
      <label>
        Translation IDs
        <textarea
          name="ids"
          rows="6"
          placeholder="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
          required
        ></textarea>
      </label>
      <label>
        Reason
        <input name="reason" required minlength="3" placeholder="e.g. endorsing top-voted Hindi gloss" />
      </label>
      <button type="submit">Promote to curator</button>
    </form>
  </section>

  <!-- 3. Bulk attribution ---------------------------------------------- -->
  <section>
    <h2>Rewrite attribution</h2>
    <p class="sub">
      Replace every <code>sourceAttribution</code> matching the old value with
      the new value, on translations of the chosen source. Optionally scope to
      one language. Use this when an upstream dictionary rebrands.
    </p>

    {#if attributionResult}
      {#if attributionResult.ok}
        <p class="ok">Updated {attributionResult.updated} row(s).</p>
      {:else}
        <p class="err">{attributionResult.message}</p>
      {/if}
    {/if}

    <form method="post" action="?/attribution" use:enhance class="stack">
      <label>
        Source class
        <select name="source" required>
          <option value="official_dictionary">Imported (official_dictionary)</option>
          <option value="curator">Curator</option>
        </select>
      </label>
      <label>
        Old attribution (exact match)
        <input name="oldAttribution" required />
      </label>
      <label>
        New attribution
        <input name="newAttribution" />
      </label>
      <label class="checkbox">
        <input type="checkbox" name="clearAttribution" value="true" />
        Clear attribution (set to NULL — overrides New attribution above)
      </label>
      <label>
        Language scope (optional)
        <select name="language">
          <option value="">All languages</option>
          <option value="hi">Hindi</option>
          <option value="mr">Marathi</option>
          <option value="or">Odia</option>
        </select>
      </label>
      <label>
        Reason
        <input name="reason" required minlength="3" placeholder="e.g. upstream rebrand 2026" />
      </label>
      <button type="submit" class="danger">Rewrite attribution</button>
    </form>
  </section>
</div>

<style>
  .page {
    max-width: 44rem;
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
    color: var(--color-fg-muted);
    margin: 0 0 0.75rem;
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
  form label {
    display: block;
    margin-bottom: 0.75rem;
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
    min-height: 6rem;
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  .stack > * {
    margin-bottom: 0.75rem;
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
  form button.danger {
    background: #b03131;
    color: #fff;
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
  .skip-list {
    margin: 0.4rem 0 0 1.2rem;
    padding: 0;
    font-size: 0.85rem;
    color: var(--color-fg-muted);
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
