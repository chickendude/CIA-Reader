<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { isThemePreference, resolveTheme } from '$lib/theme/index.js';
  import Button from '$lib/components/input/Button.svelte';
  import { getToastStore } from '$lib/components/toast/toast-store.js';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';

  const { pushToast } = getToastStore();

  let { data, form }: PageProps = $props();

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

  type SaveStatus = { state: 'saving' | 'saved' } | { state: 'error'; message: string };
  let languageSaves = $state<Record<string, SaveStatus>>({});

  let accountSave = $state<SaveStatus>();
  let pendingAccount: { displayName: string | null; themePreference: string } | null = null;
  let generatingKey = $state(false);

  async function copyApiKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      pushToast({ kind: 'success', message: 'API key copied.' });
    } catch {
      pushToast({ kind: 'error', message: 'Could not copy the API key. Select it and copy it manually.' });
    }
  }

  async function saveAccount(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const theme = fields.get('themePreference');
    if (!isThemePreference(theme)) return;

    document.documentElement.dataset.themePreference = theme;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = resolveTheme(theme, prefersDark);
    pendingAccount = { displayName: String(fields.get('displayName') ?? '').trim() || null, themePreference: theme };
    if (accountSave?.state === 'saving') return;
    accountSave = { state: 'saving' };
    while (pendingAccount) {
      const patch = pendingAccount;
      pendingAccount = null;
      try {
        const response = await fetch('/api/v1/me/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!response.ok) throw new Error('Profile update failed');
        if (!pendingAccount) await invalidateAll();
      } catch {
        if (pendingAccount) continue;
        accountSave = { state: 'error', message: 'Could not save account settings.' };
        return;
      }
    }
    accountSave = { state: 'saved' };
  }

  const generateKey: SubmitFunction = ({ cancel }) => {
    if (generatingKey) {
      cancel();
      return;
    }
    generatingKey = true;
    return async ({ update }) => {
      try {
        await update();
      } finally {
        generatingKey = false;
      }
    };
  };

  const revokeKey: SubmitFunction = () => async ({ result, update }) => {
    if (result.type === 'success' && typeof result.data?.message === 'string') {
      pushToast({ kind: 'success', message: result.data.message });
    }
    await update();
  };

  const saveLanguage: SubmitFunction = ({ formData, cancel }) => {
    const code = String(formData.get('code'));
    if (languageSaves[code]?.state === 'saving') {
      cancel();
      return;
    }
    languageSaves[code] = { state: 'saving' };
    return async ({ result }) => {
      if (result.type === 'success') {
        try {
          await invalidateAll();
          languageSaves[code] = { state: 'saved' };
        } catch {
          languageSaves[code] = { state: 'error', message: 'Preferences saved. Could not refresh settings.' };
        }
      } else {
        const message = result.type === 'failure' && typeof result.data?.message === 'string'
          ? result.data.message
          : 'Could not save these preferences.';
        languageSaves[code] = { state: 'error', message };
      }
    };
  };

  function formatDate(value: Date | string | null): string {
    if (!value) return 'Never';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }
</script>

<svelte:head>
  <title>Settings | Parhiba</title>
</svelte:head>

<section class="content">
  <header class="topbar">
    <h1 class="page-title title">Settings</h1>
  </header>

  <div class="card">
    <section class="settings-section">
      <div class="settings-h-col">
        <h2 class="settings-h">Account</h2>
      </div>
      <form method="POST" action="?/updateProfile" onsubmit={saveAccount} onchange={(event) => event.currentTarget.requestSubmit()} class="form-col">
        <div class="field">
          <span class="field-label">Email</span>
          <span class="account-email">{data.user.email}</span>
        </div>
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
        {#if accountSave?.state === 'saving'}
          <span class="muted small" role="status">Saving…</span>
        {:else if accountSave?.state === 'saved'}
          <span class="ok" role="status">Saved.</span>
        {:else if accountSave?.state === 'error'}
          <div class="form-actions">
            <span class="err" role="alert">{accountSave.message}</span>
            <Button variant="primary" type="submit">Retry</Button>
          </div>
        {/if}
        <noscript>
          <Button variant="primary" type="submit">Save account</Button>
          {#if form?.section === 'profile' && !form.ok}<span class="err" role="alert">{form.message}</span>{/if}
        </noscript>
      </form>
    </section>

    <section class="settings-section">
      <div class="settings-h-col">
        <h2 class="settings-h">Personal API key</h2>
        <p class="settings-sub">
          For use with third-party apps.
        </p>
      </div>
      <div class="form-col">
        {#if data.apiKey}
          <div class="api-key-row">
            <div>
              <code>{data.apiKey.keyPrefix}…</code>
              <span class="muted small">Last used {formatDate(data.apiKey.lastUsedAt)}</span>
            </div>
            <form method="POST" action="?/revokeApiKey" use:enhance={revokeKey}>
              <input type="hidden" name="keyId" value={data.apiKey.id} />
              <Button variant="primary" type="submit">Revoke key</Button>
            </form>
          </div>
        {:else}
          <form method="POST" action="?/createApiKey" use:enhance={generateKey}>
            <Button variant="primary" type="submit" disabled={generatingKey}>Generate key</Button>
          </form>
        {/if}
        {#if form?.section === 'apiKeys'}
          {#if !form.ok}
            <span class="err" role="alert">{form.message}</span>
          {:else if form.key && data.apiKey && form.key.startsWith(data.apiKey.keyPrefix)}
            {@const key = form.key}
            <div class="api-key-secret">
              <span role="status">{form.message}</span>
              <div class="secret-row">
                <code>{key}</code>
                <Button aria-label="Copy API key" title="Copy API key" onclick={() => copyApiKey(key)}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <rect x="8" y="8" width="12" height="13" rx="2" />
                    <path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                  </svg>
                </Button>
              </div>
            </div>
          {:else if !form.key}
            <noscript><span class="ok" role="status">{form.message}</span></noscript>
          {/if}
        {/if}
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-h-col">
        <h2 class="settings-h">Languages</h2>
      </div>
      <div class="form-col">
        {#each data.languages as lang (lang.code)}
          {@const save = languageSaves[lang.code]}
          <form
            method="POST"
            action="?/updateLanguage"
            onchange={(event) => event.currentTarget.requestSubmit()}
            use:enhance={saveLanguage}
            class="lang-form"
          >
            <header class="lang-form-h">
              <div>
                <span class="native">{lang.nativeName}</span>
                <span class="muted small">
                  {lang.displayName}
                </span>
              </div>
              {#if save?.state === 'saving'}
                <span class="muted small" role="status">Saving…</span>
              {:else if save?.state === 'saved'}
                <span class="ok" role="status">Saved.</span>
              {/if}
            </header>
            <input type="hidden" name="code" value={lang.code} />
            {#if lang.supportedRomanizations.length > 0}
              <label class="field">
                <span class="field-label">Script preference</span>
                <select name="scriptPreference" disabled={save?.state === 'saving'}>
                  {#each ['native', 'native_with_romanization', 'romanization_only'] as pref (pref)}
                    <option value={pref} selected={lang.scriptPreference === pref}>
                      {SCRIPT_PREF_LABELS[pref]}
                    </option>
                  {/each}
                </select>
              </label>
              <label class="field">
                <span class="field-label">Romanization scheme</span>
                <select name="romanizationScheme" disabled={save?.state === 'saving'}>
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
            {:else}
              <!-- Latin-script languages (Basque) render natively; no script
                   preference or romanization scheme to choose. The hidden
                   scriptPreference keeps the form payload valid. -->
              <input type="hidden" name="scriptPreference" value="native" />
              <p class="muted small">Latin script</p>
            {/if}
            {#if save?.state === 'error'}
              <div class="form-actions">
                <span class="err" role="alert">{save.message}</span>
                <Button variant="primary" type="submit">Retry</Button>
              </div>
            {/if}
            {#if lang.supportedRomanizations.length}
              <noscript>
                <Button variant="primary" type="submit">Save changes</Button>
                {#if form?.section === 'language' && form.code === lang.code}
                  {#if form.ok}<span class="ok">Saved.</span>
                  {:else}<span class="err" role="alert">{form.message}</span>{/if}
                {/if}
              </noscript>
            {/if}
          </form>
        {/each}
      </div>
    </section>
  </div>
</section>

<style>
  .topbar {
    margin-bottom: 1.25rem;
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
  .api-key-row {
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 9px;
    padding: 0.85rem 1rem;
    background: color-mix(
      in oklch,
      var(--paper, var(--color-bg)) 92%,
      transparent
    );
  }
  .api-key-secret {
    display: grid;
    gap: 0.45rem;
    margin-top: 0.4rem;
    padding: 0.7rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 7px;
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-size: 0.8rem;
  }
  .secret-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
  }
  .api-key-secret code {
    overflow-wrap: anywhere;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
  }
  .api-key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
  }
  .api-key-row > div {
    display: grid;
    gap: 0.15rem;
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
  select:focus {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 1px;
  }
  .account-email {
    align-self: flex-start;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
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
