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
  import { customizableOfficialIds } from './customize-eligibility.js';
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
    parentTranslationId: string | null;
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
    onCorrectionApplied,
  }: {
    token: ServerToken;
    anchorRect?: { top: number; left: number; bottom: number; right: number };
    isOwner: boolean;
    onClose: () => void;
    onStatusChange?: (
      lemmaId: string,
      status: 'unknown' | 'learning' | 'known' | 'ignored',
    ) => void;
    /** T-6.1: parent applies the new lemma to the token's render so
     *  the reader reflects the correction without a page reload. */
    onCorrectionApplied?: (tokenId: string, chosenLemmaId: string) => void;
  } = $props();

  let payload = $state<LemmaPayload | null>(null);
  let loadError = $state<string | null>(null);
  let showAlternates = $state(false);
  let optimisticStatus = $state<'unknown' | 'learning' | 'known' | 'ignored'>(
    untrack(() => token.status),
  );
  let writeError = $state<string | null>(null);
  // T-6.1: tracks the in-flight candidate pick so the "This one"
  // button can disable itself while the POST resolves and so the
  // user sees a visible "saving" state.
  let pickingLemmaId = $state<string | null>(null);
  let pickError = $state<string | null>(null);

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
    // T-5.21: skip the k/l/i shortcuts whenever the user is typing
    // into a form field — otherwise typing 'l' in the add-translation
    // textarea would silently flip the lemma to learning.
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target.isContentEditable) return;
    }
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

  // ---- Customize-official flow (T-3.11) ---------------------------
  // Which official translation (id) is currently being forked, if any,
  // plus the body of the in-progress fork. The eligibility set itself
  // lives in `customize-eligibility.ts` so the rule is unit-tested
  // separately from the component.
  let customizingId = $state<string | null>(null);
  let customizeBody = $state('');
  let savingCustomize = $state(false);
  let customizeError = $state<string | null>(null);

  const customizableIds = $derived(() =>
    customizableOfficialIds(
      isOwner,
      payload?.translations.official ?? [],
      payload?.translations.personal ?? [],
    ),
  );

  function startCustomize(t: PublicTranslation) {
    customizingId = t.id;
    customizeBody = t.body;
    customizeError = null;
  }

  function cancelCustomize() {
    customizingId = null;
    customizeBody = '';
    customizeError = null;
  }

  type PostError = { message: string; status: number };

  async function postTranslation(
    body: string,
    parentTranslationId: string | null,
  ): Promise<PublicTranslation> {
    if (!token.lemmaId) throw new Error('Missing lemma id');
    const res = await fetch('/api/v1/translations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lemmaId: token.lemmaId,
        body,
        targetLanguage: 'en',
        parentTranslationId,
      }),
    });
    if (!res.ok) {
      // 429 carries a JSON body with a friendly message; everything
      // else falls through to the raw text + status combo.
      let message = `POST failed: ${res.status}`;
      if (res.status === 429) {
        const errBody = (await res
          .json()
          .catch(() => null)) as { message?: string } | null;
        message =
          errBody?.message ?? 'Too many translations submitted. Try again later.';
      } else {
        const text = await res.text().catch(() => '');
        if (text) message = text;
      }
      const err: PostError = { message, status: res.status };
      throw err;
    }
    const created = (await res.json()) as { translation: PublicTranslation };
    return created.translation;
  }

  // T-5.22: re-fetch the lemma payload after a write so the new row
  // definitely shows. The optimistic prepend was unreliable across
  // payload-may-be-null states and Svelte 5 $state proxy edge cases,
  // and would have placed customize-fork rows in the wrong position
  // anyway (the personal bucket sorts oldest-first server-side).
  async function refetchPayload(lemmaId: string) {
    const fresh = await fetch(`/api/v1/lemmas/${lemmaId}/translations`);
    if (fresh.ok) {
      payload = (await fresh.json()) as LemmaPayload;
    }
  }

  async function submitNewTranslation() {
    if (!token.lemmaId) return;
    const trimmed = newTranslationBody.trim();
    if (trimmed.length === 0) {
      addError = 'Translation cannot be empty.';
      return;
    }
    const lemmaId = token.lemmaId;
    savingTranslation = true;
    addError = null;
    try {
      await postTranslation(trimmed, null);
      await refetchPayload(lemmaId);
      newTranslationBody = '';
      showAddForm = false;
    } catch (e) {
      addError = (e as PostError).message ?? (e as Error).message;
    } finally {
      savingTranslation = false;
    }
  }

  // T-5.21: Enter submits, Shift+Enter inserts a newline, Esc cancels
  // the form (without closing the panel). The textarea handler stops
  // propagation on Esc so Sheet doesn't also close itself.
  function onAddFormKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitNewTranslation();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      showAddForm = false;
      newTranslationBody = '';
      addError = null;
    }
  }

  // Mirror onAddFormKeydown so Enter/Esc on the customize textarea
  // behaves the same way as on the add-translation textarea.
  function onCustomizeKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitCustomize();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      cancelCustomize();
    }
  }

  async function submitCustomize() {
    if (!customizingId || !token.lemmaId) return;
    const trimmed = customizeBody.trim();
    if (trimmed.length === 0) {
      customizeError = 'Translation cannot be empty.';
      return;
    }
    const lemmaId = token.lemmaId;
    savingCustomize = true;
    customizeError = null;
    try {
      await postTranslation(trimmed, customizingId);
      await refetchPayload(lemmaId);
      customizingId = null;
      customizeBody = '';
    } catch (e) {
      customizeError = (e as PostError).message ?? (e as Error).message;
    } finally {
      savingCustomize = false;
    }
  }

  // T-6.1: write a `pick_candidate` correction. The reader's
  // colour rendering for this token is updated optimistically via
  // the `onCorrectionApplied` callback so the user sees the new
  // lemma immediately; the server row backs the change for next
  // read (handled by T-6.4's loader join).
  async function pickCandidate(lemmaId: string) {
    pickingLemmaId = lemmaId;
    pickError = null;
    try {
      const res = await fetch('/api/v1/me/token-corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          type: 'pick_candidate',
          chosenLemmaId: lemmaId,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      onCorrectionApplied?.(token.id, lemmaId);
      // Close the popup after a successful pick so the user lands
      // back on the reader; the parent's reactive state has already
      // re-rendered the token with the new lemma.
      onClose();
    } catch (e) {
      pickError = (e as Error).message;
    } finally {
      pickingLemmaId = null;
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

<!-- T-5.17: dimmed=false so the reader paragraph remains readable
     while a word is locked in the panel. -->
<Sheet open={true} onClose={onClose} title="" dimmed={false}>
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
          <li class="official-row">
            <div class="official-body">
              <span class="badge tone-{t.provenance.kind}">
                {t.provenance.attribution ?? t.provenance.kind}
              </span>
              {t.body}
              {#if customizableIds().has(t.id)}
                <button
                  type="button"
                  class="customize-toggle"
                  data-testid="customize-toggle"
                  onclick={() => startCustomize(t)}
                  disabled={customizingId !== null}
                  title="Fork this translation into a private copy you can edit"
                >
                  Customize
                </button>
              {/if}
            </div>
            {#if customizingId === t.id}
              <form
                class="customize-form"
                data-testid="customize-form"
                onsubmit={(e) => {
                  e.preventDefault();
                  void submitCustomize();
                }}
              >
                <textarea
                  bind:value={customizeBody}
                  rows="2"
                  maxlength="500"
                  disabled={savingCustomize}
                  aria-label="Your customized translation"
                  onkeydown={onCustomizeKeydown}
                ></textarea>
                {#if customizeError}
                  <p class="err small">{customizeError}</p>
                {/if}
                <div class="add-row">
                  <button type="submit" disabled={savingCustomize}>
                    {savingCustomize ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    class="ghost"
                    disabled={savingCustomize}
                    onclick={cancelCustomize}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            {/if}
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
              placeholder="Your translation (Enter to save, Shift+Enter for a newline, Esc to cancel)"
              rows="2"
              maxlength="500"
              disabled={savingTranslation}
              onkeydown={onAddFormKeydown}
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

    {#if token.isAmbiguous && token.candidates.length > 0}
      <button
        type="button"
        class="alt-toggle"
        onclick={() => (showAlternates = !showAlternates)}
        aria-expanded={showAlternates}
      >
        <span class="chev" aria-hidden="true" data-open={showAlternates ? '1' : '0'}>›</span>
        {token.candidates.length} alternate {token.candidates.length === 1 ? 'meaning' : 'meanings'}
      </button>
      {#if showAlternates}
        <ul class="alt-list" data-testid="alt-candidates">
          {#each token.candidates as cand (cand.lemmaId)}
            <li class="alt" data-lemma-id={cand.lemmaId}>
              <div class="alt-head">
                <span class="alt-h">{cand.headword}</span>
                <span class="alt-pos">{cand.pos}</span>
              </div>
              {#if cand.glossDefault}
                <p class="alt-gloss">{cand.glossDefault}</p>
              {/if}
              <button
                type="button"
                class="alt-pick"
                disabled={pickingLemmaId === cand.lemmaId}
                onclick={() => pickCandidate(cand.lemmaId)}
              >
                {pickingLemmaId === cand.lemmaId ? 'Saving…' : 'This one'}
              </button>
            </li>
          {/each}
        </ul>
        {#if pickError}
          <p class="err small" role="alert">{pickError}</p>
        {/if}
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

  .official-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .official-body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
  }
  .customize-toggle {
    margin-left: auto;
    padding: 0.1rem 0.55rem;
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
    font: inherit;
    font-size: 0.7rem;
    color: var(--ink-3, var(--color-fg-muted));
    cursor: pointer;
  }
  .customize-toggle:hover:not([disabled]) {
    border-color: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-accent));
  }
  .customize-toggle[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .customize-form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 3%,
      transparent
    );
  }
  .customize-form textarea {
    width: 100%;
    padding: 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.85rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    resize: vertical;
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
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .alt-toggle .chev {
    display: inline-block;
    transition: transform 140ms ease;
    font-size: 0.95rem;
    line-height: 0.8;
  }
  .alt-toggle .chev[data-open='1'] {
    transform: rotate(90deg);
  }
  .alt-list {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .alt {
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    padding: 0.55rem 0.7rem;
    background: var(--card, var(--color-bg));
  }
  .alt-head {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    margin-bottom: 0.2rem;
  }
  .alt-h {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    color: var(--ink, var(--color-fg));
  }
  .alt-pos {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .alt-gloss {
    margin: 0 0 0.45rem;
    font-size: 0.82rem;
    color: var(--ink-2, var(--color-fg));
    line-height: 1.35;
  }
  .alt-pick {
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg));
    border: 0;
    border-radius: 6px;
    padding: 0.35rem 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .alt-pick:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
