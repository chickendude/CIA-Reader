<!--
  Add a language (#436).

  Reached from the rail switcher's "Add a language" button. Mirrors the
  onboarding picker — choose a not-yet-added language + a rough proficiency
  baseline — then adds it, switches to it, and opens its library.
-->
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

  // Seed the selection from the loader once; bind:group owns it after.
  let selectedLanguage = $state<string>(((): string => data.addable[0]?.code ?? '')());
  let selectedBaseline = $state<string>('none');
</script>

<svelte:head>
  <title>Add a language — CIA Reader</title>
</svelte:head>

<div class="page">
  <h1>Add a language</h1>

  {#if data.addable.length === 0}
    <p class="lede">
      You've added every language CIA Reader supports. Switch between them from
      the language menu in the top-left, or <a href="/profile">manage them in settings</a>.
    </p>
  {:else}
    <p class="lede">
      Pick a language to add and a rough sense of what you already know. It
      becomes your current language straight away — you can switch back any time
      from the menu in the top-left.
    </p>

    <form method="POST" use:enhance>
      <fieldset>
        <legend>Which language do you want to add?</legend>
        <div class="choices">
          {#each data.addable as lang (lang.code)}
            <label class="choice" class:selected={selectedLanguage === lang.code}>
              <input
                type="radio"
                name="language"
                value={lang.code}
                bind:group={selectedLanguage}
              />
              <span class="native">{lang.nativeName}</span>
              <span class="meta">{lang.displayName}</span>
            </label>
          {/each}
        </div>
      </fieldset>

      <fieldset>
        <legend>Where are you starting from?</legend>
        <div class="choices stacked">
          {#each data.baselines as baseline (baseline)}
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

      <div class="actions">
        <button type="submit" disabled={!selectedLanguage}>Add &amp; switch</button>
        <a class="cancel" href="/library">Cancel</a>
      </div>
      {#if form && !form.ok}
        <p class="err" role="alert">{form.message}</p>
      {/if}
    </form>
  {/if}
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
  .lede a {
    color: var(--color-accent);
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
  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  button {
    padding: 0.7rem 1.25rem;
    background: var(--color-accent);
    color: var(--color-accent-fg);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    font: inherit;
    min-height: var(--touch-target);
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .cancel {
    color: var(--color-fg-muted);
    text-decoration: none;
  }
  .cancel:hover {
    color: var(--color-fg);
  }
  .err {
    color: var(--color-danger);
    margin: 0;
  }
</style>
