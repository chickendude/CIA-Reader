<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const BASELINE_LABELS: Record<string, { title: string; blurb: string }> = {
    none: {
      title: 'Starting from scratch',
      blurb: 'Every word you encounter is new until you mark it known.',
    },
    beginner: {
      title: 'Beginner — some basics',
      blurb:
        'Assume the 100 most common words are already familiar. You can change individual words later.',
    },
    intermediate: {
      title: 'Intermediate',
      blurb:
        'Assume the 1,000 most common words are already familiar — useful if you already read the language.',
    },
  };

  // Initial selection copied from the loader once; the user's bind:group
  // picks then own the truth. Wrapping the initializer in a function avoids
  // Svelte's "state references another $state only at init" warning.
  let selectedLanguage = $state<string>(((): string => data.languages[0]?.code ?? 'hi')());
  let selectedBaseline = $state<string>('none');
</script>

<svelte:head>
  <title>Welcome — CIA Reader</title>
</svelte:head>

<div class="page">
  <h1>Welcome to CIA Reader</h1>
  <p class="lede">
    Pick the language you want to read and a rough sense of what you already know. You can add
    more languages or change these choices later from your profile.
  </p>

  <form method="POST" use:enhance>
    <fieldset>
      <legend>Which language are you learning?</legend>
      <div class="choices">
        {#each data.languages as lang}
          <label class="choice" class:selected={selectedLanguage === lang.code}>
            <input
              type="radio"
              name="language"
              value={lang.code}
              bind:group={selectedLanguage}
            />
            <span class="native">{lang.nativeName}</span>
            <span class="meta">{lang.displayName} · {lang.script}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset>
      <legend>Where are you starting from?</legend>
      <div class="choices stacked">
        {#each data.baselines as baseline}
          <label class="choice stacked" class:selected={selectedBaseline === baseline}>
            <input
              type="radio"
              name="baseline"
              value={baseline}
              bind:group={selectedBaseline}
            />
            <span class="choice-title">{BASELINE_LABELS[baseline]?.title ?? baseline}</span>
            <span class="meta">{BASELINE_LABELS[baseline]?.blurb ?? ''}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <button type="submit">Get started</button>
    {#if form && !form.ok}
      <p class="err" role="alert">{form.message}</p>
    {/if}
  </form>
</div>

<style>
  .page {
    max-width: 40rem;
    margin: 0 auto;
    padding: 2rem 1.25rem;
  }
  h1 {
    margin: 0 0 0.5rem;
  }
  .lede {
    color: var(--color-fg-muted);
    margin: 0 0 1.5rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-fg-muted);
    margin-bottom: 0.5rem;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
  }
  .choices.stacked {
    grid-template-columns: 1fr;
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    min-height: var(--touch-target);
  }
  .choice input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .choice.selected {
    border-color: var(--color-accent);
    background: var(--color-surface-2);
  }
  .choice .native {
    font-size: 1.2rem;
  }
  .choice-title {
    font-weight: 600;
  }
  .meta {
    color: var(--color-fg-muted);
    font-size: var(--font-size-sm);
  }
  button {
    align-self: flex-start;
    padding: 0.7rem 1.25rem;
    background: var(--color-accent);
    color: var(--color-accent-fg);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    font: inherit;
    min-height: var(--touch-target);
  }
  .err {
    color: var(--color-danger);
    margin: 0;
  }
</style>
