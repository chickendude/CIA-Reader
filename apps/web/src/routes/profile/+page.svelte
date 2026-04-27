<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const SCRIPT_PREF_LABELS: Record<string, string> = {
    native: 'Native script only',
    native_with_romanization: 'Native script + inline romanization',
    romanization_only: 'Romanization only',
  };

  const ROMAN_LABELS: Record<string, string> = {
    iso15919: 'ISO 15919',
    iast: 'IAST',
    hunterian: 'Hunterian',
    itrans: 'ITRANS',
  };
</script>

<svelte:head>
  <title>Profile — CIA Reader</title>
</svelte:head>

<main>
  <h1>Profile</h1>

  <section>
    <h2>Account</h2>
    <form method="POST" action="?/updateProfile" use:enhance>
      <label>
        <span>Email</span>
        <input type="email" value={data.user.email} readonly aria-readonly="true" />
      </label>
      <label>
        <span>Display name</span>
        <input
          type="text"
          name="displayName"
          value={data.user.displayName ?? ''}
          maxlength="80"
          placeholder="How should we address you?"
        />
      </label>
      <fieldset>
        <legend>Theme</legend>
        {#each ['system', 'light', 'dark'] as theme}
          <label class="radio">
            <input
              type="radio"
              name="themePreference"
              value={theme}
              checked={data.user.themePreference === theme}
            />
            <span class="capitalize">{theme}</span>
          </label>
        {/each}
      </fieldset>
      <button type="submit">Save account</button>
      {#if form && form.section === 'profile' && form.ok}
        <p class="ok" role="status">Saved.</p>
      {:else if form && form.section === 'profile' && !form.ok}
        <p class="err" role="alert">{form.message}</p>
      {/if}
    </form>
  </section>

  <section>
    <h2>Languages</h2>
    <p class="muted">
      Per-language reading preferences. These defaults take effect the first time you open a
      text in that language.
    </p>
    {#each data.languages as lang}
      <form method="POST" action="?/updateLanguage" use:enhance class="lang-form">
        <header>
          <h3>
            <span class="native">{lang.nativeName}</span>
            <span class="muted">({lang.displayName} — {lang.script})</span>
          </h3>
          {#if lang.isDefault}
            <span class="muted small">Using defaults</span>
          {/if}
        </header>
        <input type="hidden" name="code" value={lang.code} />
        <label>
          <span>Script preference</span>
          <select name="scriptPreference">
            {#each ['native', 'native_with_romanization', 'romanization_only'] as pref}
              <option value={pref} selected={lang.scriptPreference === pref}>
                {SCRIPT_PREF_LABELS[pref]}
              </option>
            {/each}
          </select>
        </label>
        <label>
          <span>Romanization scheme</span>
          <select name="romanizationScheme">
            {#each lang.supportedRomanizations as scheme}
              <option value={scheme} selected={lang.romanizationScheme === scheme}>
                {ROMAN_LABELS[scheme] ?? scheme}
              </option>
            {/each}
          </select>
        </label>
        <button type="submit">Save {lang.displayName}</button>
        {#if form && form.section === 'language' && form.code === lang.code && form.ok}
          <p class="ok" role="status">Saved.</p>
        {:else if form && form.section === 'language' && form.code === lang.code && !form.ok}
          <p class="err" role="alert">{form.message}</p>
        {/if}
      </form>
    {/each}
  </section>
</main>

<style>
  main {
    max-width: 48rem;
    margin: 0 auto;
    padding: 2rem 1.25rem;
  }
  h1 {
    margin: 0 0 1rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 1.75rem 0 0.5rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h3 {
    font-size: 1rem;
    margin: 0;
  }
  section {
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 32rem;
  }
  .lang-form {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin: 0.75rem 0;
  }
  .lang-form header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.5rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }
  label.radio {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-size: 1rem;
    padding: 0.35rem 0;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
  legend {
    padding: 0 0.4rem;
    color: var(--muted);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  input[type='text'],
  input[type='email'],
  select {
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    min-height: 44px;
  }
  input[readonly] {
    color: var(--muted);
  }
  button {
    align-self: flex-start;
    padding: 0.6rem 1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    min-height: 44px;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.8rem;
  }
  .native {
    font-size: 1.1rem;
    margin-right: 0.3rem;
  }
  .capitalize {
    text-transform: capitalize;
  }
  .ok {
    color: #059669;
    margin: 0;
  }
  .err {
    color: #dc2626;
    margin: 0;
  }
</style>
