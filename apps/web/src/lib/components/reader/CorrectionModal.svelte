<!--
  Wrong-word correction modal (T-6.2).

  Opens from the WordPopup's "Fix" button. Surfaces:

    a. The candidate list — same data the alternate-meanings
       disclosure uses, but here it's the primary affordance.
    b. Script-agnostic dictionary search via <ScriptAwareInput> +
       /api/v1/dictionary/:language/lemmas?q=…
    c. Quick mark_* buttons (proper noun / foreign / not a word).
    d. "Add new word" — defers to T-6.3's new-lemma form (the
       parent supplies the open callback).

  Footer: "Also report to moderators" checkbox. Default OFF for
  pick_candidate (the reader's own correction is enough); default
  ON for manual_lemma + new_lemma since those involve
  curator-relevant judgment.

  Submission flow:

    1. POST /api/v1/me/token-corrections (always).
    2. If "Also report" is checked AND the type is non-trivial,
       POST /api/v1/me/parse-reports.
    3. Surface optimistic correction back to the parent so the
       reader re-renders the token immediately + close the modal.
-->
<script lang="ts">
  import { LANGUAGES, type LanguageCode } from '@ciareader/shared-types';
  import Modal from '$lib/components/overlay/Modal.svelte';
  import ScriptAwareInput from '$lib/components/input/ScriptAwareInput.svelte';
  import NewLemmaForm from './NewLemmaForm.svelte';
  import type { ServerToken } from './types.js';

  type CorrectionType =
    | 'pick_candidate'
    | 'manual_lemma'
    | 'mark_proper_noun'
    | 'mark_foreign'
    | 'mark_not_a_word';

  type DictionaryHit = {
    id: string;
    headword: string;
    pos: string;
    glossDefault: string | null;
  };

  interface Props {
    open: boolean;
    token: ServerToken;
    language: LanguageCode;
    onClose: () => void;
    /** Parent applies the correction so the reader re-renders. */
    onApplied: (lemmaId: string | null) => void;
    /** Test seam. */
    fetcher?: typeof fetch;
  }

  let {
    open,
    token,
    language,
    onClose,
    onApplied,
    fetcher = fetch,
  }: Props = $props();

  // T-6.3: opens NewLemmaForm on top of this modal when the user
  // taps "Add new word" from the empty search-state.
  let showNewLemma = $state(false);

  let searchQuery = $state('');
  let searchHits = $state<DictionaryHit[]>([]);
  let searchLoading = $state(false);
  let searchError = $state<string | null>(null);
  let alsoReport = $state(false);
  let savingType = $state<CorrectionType | null>(null);
  let saveError = $state<string | null>(null);

  // Debounce the dictionary search so we don't fire a request on
  // every keystroke. 200ms is short enough that the user perceives
  // it as live and long enough to skip mid-word fetches.
  let searchTimer: number | null = null;
  function scheduleSearch(q: string) {
    if (searchTimer != null) window.clearTimeout(searchTimer);
    if (!q.trim()) {
      searchHits = [];
      searchError = null;
      return;
    }
    searchTimer = window.setTimeout(() => {
      void runSearch(q);
    }, 200);
  }

  async function runSearch(q: string) {
    searchLoading = true;
    searchError = null;
    try {
      const url = `/api/v1/dictionary/${language}/lemmas?q=${encodeURIComponent(q)}&limit=10`;
      const res = await fetcher(url);
      if (!res.ok) {
        searchError = `HTTP ${res.status}`;
        return;
      }
      const data = (await res.json()) as { lemmas: DictionaryHit[] };
      searchHits = data.lemmas ?? [];
    } catch (e) {
      searchError = e instanceof Error ? e.message : 'Search failed';
    } finally {
      searchLoading = false;
    }
  }

  // T-6.2 default-checkbox rules. We compute it per-action (not as
  // a single state value) since the user could mix actions in one
  // session.
  function defaultReportFor(type: CorrectionType): boolean {
    return type === 'manual_lemma';
  }

  async function submitCorrection(
    type: CorrectionType,
    chosenLemmaId: string | null,
  ) {
    savingType = type;
    saveError = null;
    try {
      const res = await fetcher('/api/v1/me/token-corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          type,
          chosenLemmaId,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      // T-6.5 wiring: optionally file a parse_report alongside the
      // per-user correction so curators see the issue.
      const shouldReport = alsoReport ?? defaultReportFor(type);
      if (shouldReport && type !== 'pick_candidate') {
        await fetcher('/api/v1/me/parse-reports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tokenId: token.id,
            language,
            surfaceNfc: token.surface,
            originalCandidates: token.candidates.map((c) => ({
              lemmaId: c.lemmaId,
              score: c.score,
              features: c.features,
            })),
            correctedLemmaId: chosenLemmaId,
            correctionType: type,
          }),
        });
      }
      onApplied(chosenLemmaId);
      onClose();
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      savingType = null;
    }
  }

  function pickCandidate(lemmaId: string) {
    return submitCorrection('pick_candidate', lemmaId);
  }
  function pickHit(hit: DictionaryHit) {
    return submitCorrection('manual_lemma', hit.id);
  }
  function markProperNoun() {
    return submitCorrection('mark_proper_noun', null);
  }
  function markForeign() {
    return submitCorrection('mark_foreign', null);
  }
  function markNotAWord() {
    return submitCorrection('mark_not_a_word', null);
  }

  // Seed the alsoReport flag on open based on what's available.
  // A user with candidates is more likely to pick_candidate (default
  // OFF) than manual_lemma (default ON) — a reasonable starting
  // checkbox state.
  $effect(() => {
    if (open) {
      alsoReport = token.candidates.length === 0;
    }
  });
</script>

<Modal
  {open}
  {onClose}
  title="Fix this word"
  width={560}
>
  <div class="cm" data-testid="correction-modal">
    <header class="cm-head">
      <span class="cm-surface">{token.surface}</span>
      {#if token.romanization}
        <span class="cm-roman">{token.romanization}</span>
      {/if}
    </header>

    {#if token.candidates.length > 0}
      <section class="cm-section">
        <h3>Pick from candidates</h3>
        <ul class="cm-list">
          {#each token.candidates as cand (cand.lemmaId)}
            <li class="cm-row">
              <div class="cm-row-meta">
                <span class="cm-h">{cand.headword}</span>
                <span class="cm-pos">{cand.pos}</span>
                {#if cand.glossDefault}
                  <span class="cm-gloss">{cand.glossDefault}</span>
                {/if}
              </div>
              <button
                type="button"
                disabled={savingType !== null}
                onclick={() => pickCandidate(cand.lemmaId)}
              >
                {savingType === 'pick_candidate' ? 'Saving…' : 'Use'}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="cm-section">
      <h3>Search the dictionary</h3>
      <ScriptAwareInput
        {language}
        initialScript="auto"
        placeholder={`Type in ${LANGUAGES[language].nativeName} or Latin`}
        onNativeChange={(v) => {
          searchQuery = v;
          scheduleSearch(v);
        }}
      />
      {#if searchLoading}
        <p class="cm-muted">Searching…</p>
      {:else if searchError}
        <p class="cm-err" role="alert">{searchError}</p>
      {:else if searchHits.length > 0}
        <ul class="cm-list">
          {#each searchHits as hit (hit.id)}
            <li class="cm-row">
              <div class="cm-row-meta">
                <span class="cm-h">{hit.headword}</span>
                <span class="cm-pos">{hit.pos}</span>
                {#if hit.glossDefault}
                  <span class="cm-gloss">{hit.glossDefault}</span>
                {/if}
              </div>
              <button
                type="button"
                disabled={savingType !== null}
                onclick={() => pickHit(hit)}
              >
                {savingType === 'manual_lemma' ? 'Saving…' : 'Use'}
              </button>
            </li>
          {/each}
        </ul>
      {:else if searchQuery}
        <p class="cm-muted">
          No matches.
          <button
            type="button"
            class="cm-link"
            onclick={() => (showNewLemma = true)}
          >
            Add new word
          </button>
        </p>
      {:else}
        <p class="cm-muted-soft">
          Don't see it?
          <button
            type="button"
            class="cm-link"
            onclick={() => (showNewLemma = true)}
          >
            Add a new word
          </button>
        </p>
      {/if}
    </section>

    <section class="cm-section">
      <h3>Or mark this surface</h3>
      <div class="cm-marks">
        <button
          type="button"
          disabled={savingType !== null}
          onclick={markProperNoun}
        >
          Proper noun
        </button>
        <button
          type="button"
          disabled={savingType !== null}
          onclick={markForeign}
        >
          Foreign / code-switched
        </button>
        <button
          type="button"
          disabled={savingType !== null}
          onclick={markNotAWord}
        >
          Not a word
        </button>
      </div>
    </section>

    <footer class="cm-foot">
      <label class="cm-also">
        <input
          type="checkbox"
          bind:checked={alsoReport}
        />
        Also report to moderators
      </label>
      {#if saveError}
        <p class="cm-err" role="alert">{saveError}</p>
      {/if}
    </footer>
  </div>
</Modal>

<NewLemmaForm
  open={showNewLemma}
  {token}
  {language}
  onClose={() => (showNewLemma = false)}
  onApplied={(lemmaId) => {
    onApplied(lemmaId);
    onClose();
  }}
/>

<style>
  .cm {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .cm-head {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
  }
  .cm-surface {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.5rem;
    color: var(--ink, var(--color-fg));
  }
  .cm-roman {
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .cm-section h3 {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0 0 0.45rem;
    font-weight: 500;
  }
  .cm-list {
    list-style: none;
    padding: 0;
    margin: 0.4rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .cm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
  }
  .cm-row-meta {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  .cm-h {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
  }
  .cm-pos {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .cm-gloss {
    font-size: 0.82rem;
    color: var(--ink-2, var(--color-fg));
    flex: 1;
    min-width: 0;
  }
  .cm-row button {
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg));
    border: 0;
    border-radius: 5px;
    padding: 0.3rem 0.6rem;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .cm-row button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .cm-marks {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .cm-marks button {
    border: 1px solid var(--rule, var(--color-border));
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    padding: 0.35rem 0.7rem;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .cm-foot {
    border-top: 1px solid var(--rule, var(--color-border));
    padding-top: 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .cm-also {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--ink-2, var(--color-fg));
  }
  .cm-link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent, var(--color-accent));
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
  }
  .cm-muted {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    margin: 0.4rem 0 0;
  }
  .cm-muted-soft {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
    margin: 0.4rem 0 0;
    font-style: italic;
  }
  .cm-err {
    color: var(--err, #b94545);
    font-size: 0.82rem;
    margin: 0.3rem 0 0;
  }
</style>
