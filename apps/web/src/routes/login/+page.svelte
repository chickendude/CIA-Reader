<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let email = $state(untrack(() => form?.values?.email ?? ''));
  let password = $state('');

  // Discriminate the two action results by `section` so each form
  // can show its own inline message.
  const passwordError = $derived(
    form && !form.ok && 'section' in form && form.section === 'signin'
      ? form.message
      : null,
  );
  const magicResult = $derived(
    form && 'section' in form && form.section === 'magic' ? form : null,
  );
</script>

<svelte:head>
  <title>Sign in — CIA Reader</title>
</svelte:head>

<div class="page">
  {#if data.alreadySignedIn && data.authError}
    <!-- Signed-in user landed here via a stale magic-link redirect.
         Skip the sign-in forms entirely — they're redundant. Just
         show the error and a way back to the app. -->
    <header>
      <h1>Link expired</h1>
    </header>
    <p class="err" role="alert">{data.authError}</p>
    <p class="sub">
      You're still signed in. <a href={data.next}>Continue to the app</a>,
      or use the "Verify your email" button at the top of any page to
      request a fresh link.
    </p>
  {:else}
  <header>
    <h1>Sign in</h1>
    <p class="sub">
      New to CIA Reader? <a href={`/register?next=${encodeURIComponent(data.next)}`}>
        Create an account
      </a>.
    </p>
  </header>

  {#if data.authError}
    <p class="err" role="alert">{data.authError}</p>
  {/if}

  {#if passwordError}
    <p class="err" role="alert">{passwordError}</p>
  {/if}

  <form method="post" action="?/signin" use:enhance class="stack">
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
        autocomplete="current-password"
        required
        bind:value={password}
      />
    </label>
    <button type="submit">Sign in</button>
  </form>

  <hr class="divider" />

  <section class="magic">
    <h2>Or sign in with a one-time link</h2>
    <p class="sub">
      We'll email you a link that signs you in instantly — no password needed.
    </p>

    {#if magicResult}
      <p class="ok">{magicResult.message}</p>
    {/if}

    <form method="post" action="?/magic" use:enhance class="stack">
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
      <button type="submit" class="secondary">Email me a link</button>
    </form>
  </section>
  {/if}
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
  form button.secondary {
    background: transparent;
    color: var(--color-fg);
    border: 1px solid var(--color-border);
  }
  .divider {
    border: 0;
    border-top: 1px solid var(--color-border);
    margin: 2rem 0 1.5rem;
  }
  .magic h2 {
    font-size: 1.05rem;
    margin: 0 0 0.4rem;
  }
  .ok {
    color: #197a2f;
    background: color-mix(in srgb, #197a2f 8%, transparent);
    border: 1px solid color-mix(in srgb, #197a2f 30%, transparent);
    border-radius: 8px;
    padding: 0.65rem 0.85rem;
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
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
