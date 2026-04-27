<!--
  Word pop-up (T-5.4).

  Opens on tap/click of a word token. Renders:
    a. Surface form (the inflected form the user clicked)
    b. Romanization (when present)
    c. Headword + POS
    d. Morphology gloss (from token features; M2.4 produces these)
    e. Personal customization → official translations → community
       translations (the bucket order from T-3.3)
    f. Status buttons — Learning / Known / Ignored. T-5.5 wires the
       writes; here they're stub buttons.
    g. "N alternate meanings" disclosure when `is_ambiguous=true`.
       T-6.1 wires the candidate-pick action.
    h. "No dictionary match" copy + correction-flow CTA when
       `is_oov=true` (T-5.4a).

  Positioning: the popup is anchored next to the clicked token via
  fixed-positioning + a small viewport-fit nudge. We keep the markup
  body simple (a single `<div role="dialog">`) so the M11
  accessibility pass can wire focus management without restructuring.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
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

  let {
    token,
    anchorRect,
    isOwner,
    onClose,
    onStatusChange,
  }: {
    token: ServerToken;
    /** DOMRect of the clicked token's bounding box, used to anchor
     *  the popup below it (or above, if there's no room). */
    anchorRect: { top: number; left: number; bottom: number; right: number };
    isOwner: boolean;
    onClose: () => void;
    /** Called after a successful PATCH so the parent can update its
     *  in-memory token list (rerunning the loader would lose scroll
     *  position). */
    onStatusChange?: (
      lemmaId: string,
      status: 'unknown' | 'learning' | 'known' | 'ignored',
    ) => void;
  } = $props();

  let payload = $state<LemmaPayload | null>(null);
  let loadError = $state<string | null>(null);
  let showAlternates = $state(false);
  // Optimistic mirror of the token's status — flips immediately when
  // the user picks Learning / Known / Ignored, then reverts if the
  // server write fails. Initialised once via untrack so Svelte 5
  // doesn't flag the prop read.
  let optimisticStatus = $state<'unknown' | 'learning' | 'known' | 'ignored'>(
    untrack(() => token.status),
  );
  let writeError = $state<string | null>(null);

  // Position state — set after mount once we know our own size.
  let popupEl: HTMLElement | null = $state(null);
  let style = $state('');

  onMount(async () => {
    if (token.lemmaId) {
      try {
        const res = await fetch(
          `/api/v1/lemmas/${token.lemmaId}/translations`,
        );
        if (res.ok) {
          payload = (await res.json()) as LemmaPayload;
        } else {
          loadError = `Could not load translations (${res.status})`;
        }
      } catch (e) {
        loadError = `Network error: ${(e as Error).message}`;
      }
    }
    repositionToFitViewport();
  });

  function repositionToFitViewport() {
    if (!popupEl) return;
    const POPUP_W = popupEl.offsetWidth || 320;
    const POPUP_H = popupEl.offsetHeight || 240;
    const MARGIN = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = anchorRect.bottom + MARGIN;
    let left = anchorRect.left;
    if (top + POPUP_H + MARGIN > vh) {
      // Not enough room below — flip above the anchor.
      top = Math.max(MARGIN, anchorRect.top - POPUP_H - MARGIN);
    }
    if (left + POPUP_W + MARGIN > vw) {
      left = Math.max(MARGIN, vw - POPUP_W - MARGIN);
    }
    if (left < MARGIN) left = MARGIN;
    style = `position: fixed; top: ${top}px; left: ${left}px; width: ${POPUP_W}px;`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
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

  // Convert the token's UD-style features map into a human-readable
  // gloss line. The full templating logic lives in the NLP service
  // (T-2.4) — for the popup we lay them out as `Key: Value · …`.
  // Once T-2.4's gloss landed on the token row directly we'll use it
  // verbatim.
  function summarizeFeatures(features: Record<string, string> | null): string {
    if (!features) return '';
    const entries = Object.entries(features);
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}: ${v}`).join(' · ');
  }

  // ---- Add-translation flow ---------------------------------------
  // Lets the reader stash their own definition for any token whose
  // lemma is in the dictionary. Backed by POST /api/v1/translations
  // (T-3.2). The new row lands in the `personal` bucket on the next
  // render so the user sees it pinned to the top of the popup.
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
      // Optimistically prepend the new row to the personal bucket
      // so the user sees it without re-fetching.
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
    // Optimistic flip — the user sees the change before the wire
    // settles.
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
      // Revert on failure so the user knows something went wrong.
      optimisticStatus = previous;
      writeError = (e as Error).message;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  bind:this={popupEl}
  class="popup"
  role="dialog"
  aria-modal="false"
  aria-label="Word details"
  data-testid="word-popup"
  {style}
>
  <button class="close" type="button" aria-label="Close" onclick={onClose}>×</button>

  <header>
    <p class="surface">{token.surface}</p>
    {#if token.romanization}
      <p class="romanization">{token.romanization}</p>
    {/if}
    {#if payload}
      <p class="lemma-line">
        <strong>{payload.lemma.headword}</strong>
        <span class="pos">{payload.lemma.pos}</span>
      </p>
    {:else if token.isOov}
      <p class="lemma-line muted">No dictionary match</p>
    {:else if loadError}
      <p class="lemma-line err">{loadError}</p>
    {:else if token.lemmaId}
      <p class="lemma-line muted">Loading…</p>
    {/if}
  </header>

  {#if payload}
    {@const features = summarizeFeatures(null)}
    {#if features}
      <p class="features">{features}</p>
    {/if}

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

  {#if isOwner && token.lemmaId}
    <div class="status-row" role="group" aria-label="Mark status">
      <button
        type="button"
        class:active={optimisticStatus === 'learning'}
        onclick={() => markStatus('learning')}
      >
        Learning
      </button>
      <button
        type="button"
        class:active={optimisticStatus === 'known'}
        onclick={() => markStatus('known')}
      >
        Known
      </button>
      <button
        type="button"
        class:active={optimisticStatus === 'ignored'}
        onclick={() => markStatus('ignored')}
      >
        Ignored
      </button>
    </div>
    {#if writeError}
      <p class="err small">Could not save: {writeError}</p>
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

<style>
  .popup {
    z-index: 50;
    background: var(--color-bg);
    color: var(--color-fg);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    padding: 0.85rem 1rem 0.75rem;
    font-size: 0.92rem;
    line-height: 1.4;
    min-width: 18rem;
    max-width: 22rem;
    width: 22rem;
    max-height: 70vh;
    overflow: auto;
  }
  .close {
    float: right;
    background: transparent;
    border: 0;
    font-size: 1.2rem;
    color: var(--color-fg-muted);
    cursor: pointer;
    line-height: 1;
    padding: 0 0.25rem;
  }
  header {
    margin-bottom: 0.5rem;
  }
  .surface {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
  }
  .romanization {
    margin: 0;
    color: var(--color-fg-muted);
    font-size: 0.85rem;
  }
  .lemma-line {
    margin: 0.4rem 0 0;
    font-size: 0.95rem;
  }
  .pos {
    color: var(--color-fg-muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-left: 0.4rem;
  }
  .features {
    margin: 0.25rem 0 0.5rem;
    color: var(--color-fg-muted);
    font-size: 0.85rem;
  }
  .translations {
    list-style: none;
    margin: 0.5rem 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .translations li {
    font-size: 0.9rem;
  }
  .badge {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    margin-right: 0.4rem;
    font-size: 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    color: var(--color-fg-muted);
    background: var(--color-bg);
  }
  .tone-personal {
    border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    color: var(--color-accent);
  }
  .tone-curator {
    border-color: color-mix(in srgb, #197a2f 60%, transparent);
    color: #197a2f;
  }
  .tone-imported {
    border-color: var(--color-border);
  }
  .tone-community {
    border-color: color-mix(in srgb, #b07a31 60%, transparent);
    color: #b07a31;
  }
  .muted {
    color: var(--color-fg-muted);
  }
  .small {
    font-size: 0.8rem;
  }
  .err {
    color: #b03131;
  }
  .status-row {
    display: flex;
    gap: 0.4rem;
    margin: 0.6rem 0 0.4rem;
  }
  .status-row button {
    flex: 1;
    padding: 0.4rem 0.5rem;
    font: inherit;
    font-size: 0.8rem;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-fg);
    cursor: pointer;
    min-height: 36px;
  }
  .status-row button.active {
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border-color: var(--color-accent);
  }
  .alt-toggle {
    margin-top: 0.6rem;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    font: inherit;
    font-size: 0.8rem;
    color: var(--color-fg-muted);
    cursor: pointer;
  }
  .add-toggle {
    margin-top: 0.5rem;
    background: transparent;
    border: 1px dashed var(--color-border);
    border-radius: 6px;
    padding: 0.4rem 0.7rem;
    font: inherit;
    font-size: 0.8rem;
    color: var(--color-accent);
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .add-toggle:hover {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  }
  .add-form {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .add-form textarea {
    width: 100%;
    padding: 0.5rem 0.6rem;
    font: inherit;
    font-size: 0.9rem;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    resize: vertical;
  }
  .add-row {
    display: flex;
    gap: 0.4rem;
  }
  .add-row button {
    flex: 1;
    padding: 0.4rem 0.6rem;
    font: inherit;
    font-size: 0.85rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    min-height: 36px;
  }
  .add-row button.ghost {
    background: transparent;
    color: var(--color-fg);
    border: 1px solid var(--color-border);
  }
  .add-row button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
