<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let email = $state(untrack(() => form?.values?.email ?? ''));
  let password = $state('');
  let displayName = $state(untrack(() => form?.values?.displayName ?? ''));
</script>

<svelte:head>
  <title>Create account — CIA Reader</title>
</svelte:head>

<div class="page">
  <header>
    <h1>Create account</h1>
    <p class="sub">
      Already have one? <a href={`/login?next=${encodeURIComponent(data.next)}`}>
        Sign in
      </a>.
    </p>
  </header>

  {#if form && !form.ok}
    <p class="err" role="alert">{form.message}</p>
  {/if}

  <form method="post" use:enhance class="stack">
    <label>
      Email
      <input
        name="email"
        type="email"
        autocomplete="email"
        required
        bind:value={email}
      />
    </label>
    <label>
      Password
      <input
        name="password"
        type="password"
        autocomplete="new-password"
        required
        minlength="10"
        bind:value={password}
      />
      <span class="hint">10 characters or more.</span>
    </label>
    <label>
      Display name (optional)
      <input
        name="displayName"
        type="text"
        autocomplete="nickname"
        maxlength="80"
        bind:value={displayName}
      />
    </label>
    <button type="submit">Create account</button>
  </form>
</div>

<style>
  .page {
    max-width: 26rem;
    margin: 2rem auto;
    padding: 1rem 1.25rem 3rem;
  }
  header h1 {
    margin: 0 0 0.4rem;
    font-size: 1.6rem;
  }
  .sub {
    color: var(--color-fg-muted);
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .sub a {
    color: var(--color-accent);
  }
  form label {
    display: block;
    margin-bottom: 0.75rem;
    font-size: 0.9rem;
  }
  form input {
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
  .hint {
    display: block;
    margin-top: 0.25rem;
    color: var(--color-fg-muted);
    font-size: 0.8rem;
  }
  .stack > * {
    margin-bottom: 0.75rem;
  }
  form button {
    min-height: 44px;
    width: 100%;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }
  .err {
    color: #b03131;
    background: color-mix(in srgb, #b03131 8%, transparent);
    border: 1px solid color-mix(in srgb, #b03131 30%, transparent);
    border-radius: 8px;
    padding: 0.65rem 0.85rem;
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
</style>
