<!--
  New-lemma submission form (T-6.3).

  Invoked from the CorrectionModal's "Add new word" link when the
  dictionary search comes up empty. Renders inside its own Modal so
  it sits on top of the reader popup chrome and can be cancelled
  cleanly.

  Fields:
    - headword (native script via <ScriptAwareInput>)
    - POS (select — POS list mirrors the curator dictionary editor)
    - short gloss (translation preview)
    - optional notes

  POSTs to /api/v1/me/lemma-proposals which writes the proposal +
  the per-user token_corrections row + the parse_report.
-->
<script lang="ts">
  import Modal from '$lib/components/overlay/Modal.svelte';
  import ScriptAwareInput from '$lib/components/input/ScriptAwareInput.svelte';
  import type { LanguageCode } from '@ciareader/shared-types';
  import type { ServerToken } from './types.js';

  interface Props {
    open: boolean;
    token: ServerToken;
    language: LanguageCode;
    onClose: () => void;
    /** Parent applies the proposal — same callback shape as the
     *  CorrectionModal so the reader's render pipeline doesn't
     *  branch on the source of the correction. */
    onApplied: (lemmaId: string | null) => void;
    fetcher?: typeof fetch;
  }

  let { open, token, language, onClose, onApplied, fetcher = fetch }: Props = $props();

  // POS list — matches the universal-dependencies tags the worker
  // emits + the dictionary editor's dropdown. Curators normalize at
  // accept time if a proposer picks an unconventional value.
  const POS_OPTIONS = [
    'NOUN',
    'PROPN',
    'VERB',
    'ADJ',
    'ADV',
    'PRON',
    'DET',
    'ADP',
    'CCONJ',
    'SCONJ',
    'PART',
    'INTJ',
    'NUM',
    'OTHER',
  ] as const;

  let headword = $state('');
  let pos: (typeof POS_OPTIONS)[number] = $state('NOUN');
  let gloss = $state('');
  let notes = $state('');
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  function reset() {
    headword = '';
    pos = 'NOUN';
    gloss = '';
    notes = '';
    saveError = null;
  }

  // Re-seed when the modal opens for a new token.
  $effect(() => {
    if (open) reset();
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (!headword.trim()) {
      saveError = 'Headword is required';
      return;
    }
    saving = true;
    saveError = null;
    try {
      const res = await fetcher('/api/v1/me/lemma-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          language,
          headword,
          pos,
          glossDefault: gloss.trim() || null,
          notes: notes.trim() || null,
          surfaceNfc: token.surface,
          originalCandidates: token.candidates.map((c) => ({
            lemmaId: c.lemmaId,
            score: c.score,
            features: c.features,
          })),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(t || `HTTP ${res.status}`);
      }
      // Proposal is pending; we don't have a real lemma id yet, so
      // pass null to clear the worker's primary on this token. The
      // reader will render the surface as plain text until the
      // curator promotes the proposal.
      onApplied(null);
      onClose();
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Save failed';
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} {onClose} title="Add a new word" width={520}>
  <form class="nlf" onsubmit={submit} data-testid="new-lemma-form">
    <p class="nlf-hint">
      Submit a new dictionary entry for <bdi class="surface">{token.surface}</bdi>.
      Curators review proposals before they appear in the public dictionary.
    </p>

    <label class="nlf-row">
      <span class="nlf-l">Headword</span>
      <ScriptAwareInput
        {language}
        initialScript="auto"
        value={token.surface}
        onNativeChange={(v) => (headword = v)}
      />
    </label>

    <label class="nlf-row">
      <span class="nlf-l">Part of speech</span>
      <select id="nlf-pos" bind:value={pos}>
        {#each POS_OPTIONS as option}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>

    <label class="nlf-row">
      <span class="nlf-l">Short gloss</span>
      <input
        id="nlf-gloss"
        type="text"
        placeholder="A short English translation"
        bind:value={gloss}
        maxlength="280"
      />
    </label>

    <label class="nlf-row">
      <span class="nlf-l">Notes (optional)</span>
      <textarea
        id="nlf-notes"
        rows="3"
        placeholder="Anything helpful for the reviewer"
        bind:value={notes}
        maxlength="2000"
      ></textarea>
    </label>

    {#if saveError}
      <p class="nlf-err" role="alert">{saveError}</p>
    {/if}

    <footer class="nlf-foot">
      <button type="button" class="nlf-cancel" onclick={onClose}>
        Cancel
      </button>
      <button
        type="submit"
        class="nlf-submit"
        disabled={saving || !headword.trim()}
      >
        {saving ? 'Submitting…' : 'Submit proposal'}
      </button>
    </footer>
  </form>
</Modal>

<style>
  .nlf {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .nlf-hint {
    font-size: 0.85rem;
    color: var(--ink-2, var(--color-fg));
    margin: 0;
  }
  .nlf-hint .surface {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    margin: 0 0.15rem;
  }
  .nlf-row {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .nlf-l {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    font-weight: 500;
  }
  .nlf-row input[type='text'],
  .nlf-row textarea,
  .nlf-row select {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-size: 0.9rem;
  }
  .nlf-foot {
    display: flex;
    justify-content: flex-end;
    gap: 0.45rem;
    border-top: 1px solid var(--rule, var(--color-border));
    padding-top: 0.7rem;
  }
  .nlf-cancel {
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    padding: 0.4rem 0.85rem;
    cursor: pointer;
    font: inherit;
    color: var(--ink-2, var(--color-fg));
  }
  .nlf-submit {
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg));
    border: 0;
    border-radius: 6px;
    padding: 0.4rem 0.95rem;
    cursor: pointer;
    font: inherit;
    font-weight: 500;
  }
  .nlf-submit:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .nlf-err {
    color: var(--err, #b94545);
    font-size: 0.82rem;
    margin: 0;
  }
</style>
