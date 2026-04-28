<!--
  Word side panel (T-5.4 → T-5.10).

  Opens on tap/click of a word. Renders inside a <Sheet> so it slides
  up from the bottom on <960px and in from the right on >=960px,
  matching the CIAR design's reader side-panel.

  Content (unchanged from T-5.4):
    a. Surface form + romanization + headword + POS
    b. Personal → official → community translations (T-3.3 ordering)
    c. "+ Add my translation" form (T-3.2)
    d. Status buttons — Learning / Known / Ignored (T-5.5)
    e. "N alternate meanings" disclosure when is_ambiguous=true
       (T-6.1 wires the candidate-pick action)
    f. "No dictionary match" copy when is_oov=true (T-5.4a)

  Keyboard: Sheet handles Esc + focus trap. We keep k/l/i status
  shortcuts so the existing keyboard-first flow (T-5.7) still works.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from '../overlay/Sheet.svelte';
  import type { ServerToken } from './types.js';

  type Provenance =
    | { kind: 'personal'; attribution: null }
    | { kind: 'curator'; attribution: string | null }
    | { kind: 'imported'; attribution: string | null }
    | { kind: 'community'; attribution: null };

  type PublicTranslation = {
    id: string;
    body: string;
    targetLanguage: string;
    sourceAttribution: string | null;
    provenance: Provenance;
  };

  type LemmaPayload = {
    lemma: {
      id: string;
      headword: string;
      pos: string;
      glossDefault: string | null;
    };
    translations: {
      personal: PublicTranslation[];
      official: PublicTranslation[];
      community: PublicTranslation[];
    };
  };

  // anchorRect is accepted but unused — anchor positioning was used
  // before T-5.10 switched to Sheet. Kept on the prop signature for
  // backward compat with callers that still pass it.
  let {
    token,
    isOwner,
    onClose,
    onStatusChange,
  }: {
    token: ServerToken;
    anchorRect?: { top: number; left: number; bottom: number; right: number };
    isOwner: boolean;
    onClose: () => void;
    onStatusChange?: (
      lemmaId: string,
      status: 'unknown' | 'learning' | 'known' | 'ignored',
    ) => void;
  } = $props();

  let payload = $state<LemmaPayload | null>(null);
  let loadError = $state<string | null>(null);
  let showAlternates = $state(false);
  let optimisticStatus = $state<'unknown' | 'learning' | 'known' | 'ignored'>(
    untrack(() => token.status),
  );
  let writeError = $state<string | null>(null);

  // Re-fetch translations whenever the token prop changes. `$effect`
  // runs the body each time `token` (and thus `token.id` / `lemmaId`)
  // changes — which happens when the parent rebinds the popup to a
  // different word — so navigating word-to-word loads the new entry
  // instead of leaving the old one stuck.
  $effect(() => {
    const t = token;
    optimisticStatus = t.status;
    if (!t.lemmaId) {
      payload = null;
      loadError = null;
      return;
    }
    let cancelled = false;
    payload = null;
    loadError = null;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/lemmas/${t.lemmaId}/translations`);
        if (cancelled) return;
        if (res.ok) {
          payload = (await res.json()) as LemmaPayload;
        } else {
          loadError = `Could not load translations (${res.status})`;
        }
      } catch (e) {
        if (!cancelled) {
          loadError = `Network error: ${(e as Error).message}`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!isOwner || !token.lemmaId) return;
    // T-5.7: power-user shortcuts. Only fire when modifier-free so we
    // don't fight the browser's own shortcuts (Cmd-K, Ctrl-L, etc.).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      void markStatus('known');
    } else if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      void markStatus('learning');
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      void markStatus('ignored');
    }
  }

  const allTranslations = $derived(() => {
    if (!payload) return [];
    return [
      ...payload.translations.personal,
      ...payload.translations.official,
      ...payload.translations.community,
    ];
  });

  // ---- Add-translation flow ---------------------------------------
  let showAddForm = $state(false);
  let newTranslationBody = $state('');
  let savingTranslation = $state(false);
  let addError = $state<string | null>(null);

  async function submitNewTranslation() {
    if (!token.lemmaId) return;
    const trimmed = newTranslationBody.trim();
    if (trimmed.length === 0) {
      addError = 'Translation cannot be empty.';
      return;
    }
    savingTranslation = true;
    addError = null;
    try {
      const res = await fetch('/api/v1/translations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lemmaId: token.lemmaId,
          body: trimmed,
          targetLanguage: 'en',
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `POST failed: ${res.status}`);
      }
      const created = (await res.json()) as {
        translation: {
          id: string;
          body: string;
          targetLanguage: string;
          sourceAttribution: string | null;
          provenance: Provenance;
        };
      };
      if (payload) {
        payload = {
          ...payload,
          translations: {
            ...payload.translations,
            personal: [created.translation, ...payload.translations.personal],
          },
        };
      }
      newTranslationBody = '';
      showAddForm = false;
    } catch (e) {
      addError = (e as Error).message;
    } finally {
      savingTranslation = false;
    }
  }

  async function markStatus(
    status: 'unknown' | 'learning' | 'known' | 'ignored',
  ) {
    if (!token.lemmaId) return;
    const lemmaId = token.lemmaId;
    const previous = optimisticStatus;
    optimisticStatus = status;
    writeError = null;
    try {
      const res = await fetch(`/api/v1/me/known-lemmas/${lemmaId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        throw new Error(`PATCH failed: ${res.status}`);
      }
      onStatusChange?.(lemmaId, status);
    } catch (e) {
      optimisticStatus = previous;
      writeError = (e as Error).message;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Sheet open={true} onClose={onClose} title="">
  <div data-testid="word-popup">
    <header class="sp-head">
      <h2 class="sp-word">{token.surface}</h2>
      {#if token.romanization}
        <p class="sp-roman">{token.romanization}</p>
      {/if}
      {#if payload}
        <p class="sp-row">
          <span class="k">Lemma</span>
          <span class="v">{payload.lemma.headword}</span>
        </p>
        <p class="sp-row">
          <span class="k">Part of speech</span>
          <span class="v">{payload.lemma.pos}</span>
        </p>
      {:else if token.isOov}
        <p class="muted">No dictionary match</p>
      {:else if loadError}
        <p class="err">{loadError}</p>
      {:else if token.lemmaId}
        <p class="muted">Loading…</p>
      {/if}
    </header>

    {#if isOwner && token.lemmaId}
      <div class="sp-status" role="group" aria-label="Mark status">
        <button
          type="button"
          data-active={optimisticStatus === 'learning' ? '1' : '0'}
          onclick={() => markStatus('learning')}
        >
          Learning
        </button>
        <button
          type="button"
          data-active={optimisticStatus === 'known' ? '1' : '0'}
          onclick={() => markStatus('known')}
        >
          Known
        </button>
        <button
          type="button"
          data-active={optimisticStatus === 'ignored' ? '1' : '0'}
          onclick={() => markStatus('ignored')}
        >
          Ignored
        </button>
      </div>
      {#if writeError}
        <p class="err small">Could not save: {writeError}</p>
      {/if}
    {/if}

    {#if payload}
      <h3 class="sp-section-h">
        Translations
        <span class="muted">{allTranslations().length}</span>
      </h3>

      <ul class="translations">
        {#each payload.translations.personal as t (t.id)}
          <li>
            <span class="badge tone-personal">yours</span>
            {t.body}
          </li>
        {/each}
        {#each payload.translations.official as t (t.id)}
          <li>
            <span class="badge tone-{t.provenance.kind}">
              {t.provenance.attribution ?? t.provenance.kind}
            </span>
            {t.body}
          </li>
        {/each}
        {#each payload.translations.community as t (t.id)}
          <li>
            <span class="badge tone-community">community</span>
            {t.body}
          </li>
        {/each}
        {#if allTranslations().length === 0}
          <li class="muted">No translations yet.</li>
        {/if}
      </ul>

      {#if isOwner}
        {#if showAddForm}
          <form
            class="add-form"
            onsubmit={(e) => {
              e.preventDefault();
              void submitNewTranslation();
            }}
          >
            <textarea
              bind:value={newTranslationBody}
              placeholder="Your translation in English"
              rows="2"
              maxlength="500"
              disabled={savingTranslation}
            ></textarea>
            {#if addError}
              <p class="err small">{addError}</p>
            {/if}
            <div class="add-row">
              <button type="submit" disabled={savingTranslation}>
                {savingTranslation ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                class="ghost"
                disabled={savingTranslation}
                onclick={() => {
                  showAddForm = false;
                  newTranslationBody = '';
                  addError = null;
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        {:else}
          <button
            type="button"
            class="add-toggle"
            onclick={() => {
              showAddForm = true;
            }}
          >
            + Add my translation
          </button>
        {/if}
      {/if}
    {/if}

    {#if token.isAmbiguous}
      <button
        type="button"
        class="alt-toggle"
        onclick={() => (showAlternates = !showAlternates)}
        aria-expanded={showAlternates}
      >
        {showAlternates ? 'Hide' : 'Show'} alternate meanings
      </button>
      {#if showAlternates}
        <p class="muted small">
          Alternate-candidate selection lands in T-6.1. The reader knows
          this token has more than one plausible parse.
        </p>
      {/if}
    {/if}
  </div>
</Sheet>

<style>
  .sp-head {
    margin-bottom: 0.85rem;
  }
  .sp-word {
    margin: 0 0 0.25rem;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.85rem;
    line-height: 1.1;
    color: var(--ink, var(--color-fg));
  }
  .sp-roman {
    margin: 0 0 0.85rem;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .sp-row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.5rem 0;
    margin: 0;
    border-top: 1px solid var(--rule-2, var(--color-border));
  }
  .sp-row .k {
    width: 92px;
    flex-shrink: 0;
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .sp-row .v {
    flex: 1;
    color: var(--ink, var(--color-fg));
    font-size: 0.85rem;
  }

  .sp-status {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    margin: 0.6rem 0 0.85rem;
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 5%,
      transparent
    );
    padding: 3px;
    border-radius: 9px;
  }
  .sp-status button {
    height: 30px;
    border: 0;
    background: transparent;
    border-radius: 7px;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--ink-2, var(--color-fg-muted));
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .sp-status button:hover {
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 5%,
      transparent
    );
  }
  .sp-status button[data-active='1'] {
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .sp-section-h {
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 1rem 0 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 500;
  }

  .translations {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .translations li {
    font-size: 0.88rem;
    line-height: 1.4;
    color: var(--ink, var(--color-fg));
  }
  .badge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    margin-right: 0.4rem;
    font-size: 0.66rem;
    border-radius: 999px;
    border: 1px solid var(--rule, var(--color-border));
    color: var(--ink-3, var(--color-fg-muted));
    background: var(--card, var(--color-bg));
  }
  .tone-personal {
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 60%,
      transparent
    );
    color: var(--accent-ink, var(--color-accent));
  }
  .tone-curator {
    border-color: color-mix(
      in oklch,
      var(--green, #197a2f) 60%,
      transparent
    );
    color: var(--green, #197a2f);
  }
  .tone-imported {
    border-color: var(--rule, var(--color-border));
  }
  .tone-community {
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 40%,
      transparent
    );
    color: var(--ink-3, var(--color-fg-muted));
  }

  .muted {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .small {
    font-size: 0.75rem;
  }
  .err {
    color: var(--rose, #b03131);
  }

  .add-toggle {
    margin-top: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.7rem;
    background: transparent;
    border: 1px dashed var(--rule, var(--color-border));
    border-radius: 8px;
    color: var(--ink-3, var(--color-fg-muted));
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    text-align: center;
  }
  .add-toggle:hover {
    border-color: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-accent));
    border-style: solid;
  }
  .add-form {
    margin-top: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .add-form textarea {
    width: 100%;
    padding: 0.55rem 0.7rem;
    font: inherit;
    font-size: 0.85rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    resize: vertical;
  }
  .add-row {
    display: flex;
    gap: 0.4rem;
  }
  .add-row button {
    flex: 1;
    padding: 0.5rem 0.6rem;
    font: inherit;
    font-size: 0.82rem;
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
    border: 1px solid var(--ink, var(--color-fg));
    border-radius: 8px;
    cursor: pointer;
    min-height: 36px;
  }
  .add-row button.ghost {
    background: transparent;
    color: var(--ink, var(--color-fg));
    border: 1px solid var(--rule, var(--color-border));
  }
  .add-row button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .alt-toggle {
    margin-top: 0.85rem;
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
    padding: 0.4rem 0.85rem;
    font: inherit;
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
    cursor: pointer;
  }
</style>
