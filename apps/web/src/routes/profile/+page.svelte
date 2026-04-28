<!--
  Profile / settings (T-1.2 → T-5.14).

  CIAR design's sectioned layout: each section has a heading + subtitle
  on the left and the actual controls on the right. On <768px the
  two columns stack. The form actions and validation flow are
  unchanged from T-1.2 — this PR only restyles.
-->
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
  <title>Settings — CIA Reader</title>
</svelte:head>

<section class="content">
  <header class="topbar">
    <div>
      <h1 class="title">Settings</h1>
      <p class="sub">Account + per-language reading preferences.</p>
    </div>
  </header>

  <div class="card">
    <section class="settings-section">
      <div class="settings-h-col">
        <h2 class="settings-h">Account</h2>
        <p class="settings-sub">Used across all languages.</p>
      </div>
      <form method="POST" action="?/updateProfile" use:enhance class="form-col">
        <label class="field">
          <span class="field-label">Email</span>
          <input
            type="email"
            value={data.user.email}
            readonly
            aria-readonly="true"
          />
        </label>
        <label class="field">
          <span class="field-label">Display name</span>
          <input
            type="text"
            name="displayName"
            value={data.user.displayName ?? ''}
            maxlength="80"
            placeholder="How should we address you?"
          />
        </label>
        <fieldset class="field">
          <legend class="field-label">Theme</legend>
          <div class="radio-row">
            {#each ['system', 'light', 'dark'] as theme (theme)}
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
          </div>
        </fieldset>
        <div class="form-actions">
          <button type="submit" class="btn">Save account</button>
          {#if form && form.section === 'profile' && form.ok}
            <span class="ok" role="status">Saved.</span>
          {:else if form && form.section === 'profile' && !form.ok}
            <span class="err" role="alert">{form.message}</span>
          {/if}
        </div>
      </form>
    </section>

    <section class="settings-section">
      <div class="settings-h-col">
        <h2 class="settings-h">Languages</h2>
        <p class="settings-sub">
          Per-language reading defaults. These take effect the first time you
          open a text in that language.
        </p>
      </div>
      <div class="form-col">
        {#each data.languages as lang (lang.code)}
          <form
            method="POST"
            action="?/updateLanguage"
            use:enhance
            class="lang-form"
          >
            <header class="lang-form-h">
              <div>
                <span class="native">{lang.nativeName}</span>
                <span class="muted small">
                  {lang.displayName} · {lang.script}
                </span>
              </div>
              {#if lang.isDefault}
                <span class="muted small">Using defaults</span>
              {/if}
            </header>
            <input type="hidden" name="code" value={lang.code} />
            <label class="field">
              <span class="field-label">Script preference</span>
              <select name="scriptPreference">
                {#each ['native', 'native_with_romanization', 'romanization_only'] as pref (pref)}
                  <option value={pref} selected={lang.scriptPreference === pref}>
                    {SCRIPT_PREF_LABELS[pref]}
                  </option>
                {/each}
              </select>
            </label>
            <label class="field">
              <span class="field-label">Romanization scheme</span>
              <select name="romanizationScheme">
                {#each lang.supportedRomanizations as scheme (scheme)}
                  <option
                    value={scheme}
                    selected={lang.romanizationScheme === scheme}
                  >
                    {ROMAN_LABELS[scheme] ?? scheme}
                  </option>
                {/each}
              </select>
            </label>
            <div class="form-actions">
              <button type="submit" class="btn secondary">
                Save {lang.displayName}
              </button>
              {#if form && form.section === 'language' && form.code === lang.code && form.ok}
                <span class="ok" role="status">Saved.</span>
              {:else if form && form.section === 'language' && form.code === lang.code && !form.ok}
                <span class="err" role="alert">{form.message}</span>
              {/if}
            </div>
          </form>
        {/each}
      </div>
    </section>
  </div>
</section>

<style>
  .content {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.75rem 1.25rem 3rem;
  }
  @media (min-width: 768px) {
    .content {
      padding: 2.25rem 2rem 3.5rem;
    }
  }
  .topbar {
    margin-bottom: 1.25rem;
  }
  .title {
    font-family: var(--font-serif, var(--font-ui));
    font-weight: 600;
    font-size: 1.4rem;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--ink, var(--color-fg));
  }
  .sub {
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0.15rem 0 0;
  }

  .card {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 14px;
    box-shadow: var(--shadow-1, 0 1px 2px rgba(0, 0, 0, 0.04));
    overflow: hidden;
  }

  .settings-section {
    padding: 1.25rem 1.4rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    align-items: start;
    border-top: 1px solid var(--rule-2, var(--color-border));
  }
  .settings-section:first-child {
    border-top: 0;
  }
  @media (min-width: 768px) {
    .settings-section {
      grid-template-columns: 220px 1fr;
      gap: 1.5rem;
      padding: 1.25rem 1.4rem;
    }
  }
  .settings-h {
    font-family: var(--font-serif, var(--font-ui));
    font-weight: 500;
    font-size: 1rem;
    color: var(--ink, var(--color-fg));
    margin: 0 0 0.25rem;
  }
  .settings-sub {
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0;
    line-height: 1.4;
  }

  .form-col {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .lang-form {
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 9px;
    padding: 0.85rem 1rem;
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 92%,
      transparent
    );
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .lang-form-h {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }
  .native {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.1rem;
    margin-right: 0.3rem;
    color: var(--ink, var(--color-fg));
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    border: 0;
    padding: 0;
    margin: 0;
  }
  .field-label {
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  input[type='text'],
  input[type='email'],
  select {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font: inherit;
    font-size: 0.85rem;
    min-height: var(--touch-target, 44px);
  }
  input[type='text']:focus,
  input[type='email']:focus,
  select:focus {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 1px;
  }
  input[readonly] {
    color: var(--ink-3, var(--color-fg-muted));
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 90%,
      transparent
    );
  }

  .radio-row {
    display: flex;
    gap: 0.85rem;
    flex-wrap: wrap;
  }
  .radio {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--ink, var(--color-fg));
    padding: 0.35rem 0;
    cursor: pointer;
  }
  .radio input {
    accent-color: var(--accent, var(--color-accent));
  }

  .btn {
    height: var(--touch-target, 44px);
    padding: 0 1rem;
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
    border: 1px solid var(--ink, var(--color-fg));
    border-radius: 8px;
    font-family: var(--font-sans, var(--font-ui));
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
  }
  .btn.secondary {
    background: transparent;
    color: var(--ink-2, var(--color-fg));
    border-color: var(--rule, var(--color-border));
  }
  .form-actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-top: 0.5rem;
  }

  .muted {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .small {
    font-size: 0.78rem;
  }
  .ok {
    color: var(--green, var(--color-success));
    font-size: 0.85rem;
  }
  .err {
    color: var(--rose, var(--color-danger));
    font-size: 0.85rem;
  }
  .capitalize {
    text-transform: capitalize;
  }
</style>
