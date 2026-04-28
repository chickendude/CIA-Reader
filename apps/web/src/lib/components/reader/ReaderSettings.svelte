<!--
  Reader settings popover (T-5.1b).

  Sheet that slides in from the right (>=960px) or up from the bottom
  on phones. Every change is applied to the parent's settings prop
  immediately (live preview) and persisted via a debounced PATCH to
  /api/v1/me/languages/:code so the user lands on the same setup the
  next time they open this language.

  Anonymous viewers (signed-out reads of an official text) see the
  popover but skip the persistence path — settings live for the
  session only.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from '$lib/components/overlay/Sheet.svelte';
  import {
    DEFAULT_READER_SETTINGS,
    FONT_SIZE_MAX,
    FONT_SIZE_MIN,
    LINE_SPACING_MAX,
    LINE_SPACING_MIN,
    WORDS_PER_PAGE_MAX,
    WORDS_PER_PAGE_MIN,
    clampReaderSettings,
    recommendedFontsFor,
    settingsDiff,
    type ReaderSettings,
  } from './reader-settings.js';
  import {
    LANGUAGES,
    type LanguageCode,
    type RomanizationScheme,
  } from '@ciareader/shared-types';

  interface Props {
    open: boolean;
    onClose: () => void;
    language: LanguageCode;
    settings: ReaderSettings;
    /** Called on every change with the next settings (live preview). */
    onChange: (next: ReaderSettings) => void;
    /** When true, settings persist via the API; when false (anon
     *  reads of an official text) we still live-preview but skip the
     *  network call. */
    canPersist?: boolean;
    /** Override hook for tests. Real callers omit this. */
    fetcher?: typeof fetch;
  }

  let {
    open,
    onClose,
    language,
    settings,
    onChange,
    canPersist = true,
    fetcher = fetch,
  }: Props = $props();

  const recommendedFonts = $derived(recommendedFontsFor(language));
  const supportedRomanizations = $derived(LANGUAGES[language].supportedRomanizations);

  // Local mirror so a slider drag can fire onChange every tick
  // (live preview) without re-rendering the whole popover.
  let local = $state<ReaderSettings>(untrack(() => settings));
  $effect(() => {
    // Sync from props when the parent hands us a new settings ref
    // (e.g. after a save round-trip surfacing the canonical row).
    local = settings;
  });

  let saveTimer: number | null = null;
  // Initialize once from the prop using untrack so the reactive
  // graph doesn't capture a snapshot of `settings`. The prop's
  // canonical value flows through `settings` → `$effect` → `local`;
  // `lastPersisted` is the diff baseline and is updated by save.
  let lastPersisted = $state<ReaderSettings>(untrack(() => settings));
  let saveError = $state<string | null>(null);

  function commit(next: ReaderSettings) {
    const clamped = clampReaderSettings(next);
    local = clamped;
    onChange(clamped);
    if (!canPersist) return;
    if (saveTimer != null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void persist(clamped);
    }, 300);
  }

  async function persist(next: ReaderSettings) {
    const diff = settingsDiff(lastPersisted, next);
    if (Object.keys(diff).length === 0) return;
    try {
      const res = await fetcher(`/api/v1/me/languages/${language}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(diff),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        saveError = text || `HTTP ${res.status}`;
        return;
      }
      lastPersisted = next;
      saveError = null;
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save';
    }
  }

  function reset() {
    commit({ ...DEFAULT_READER_SETTINGS });
  }
</script>

<Sheet {open} {onClose} title="Reader settings" width={400}>
  <div class="rs" data-testid="reader-settings">
    <section>
      <h3>Layout</h3>
      <div class="rs-row">
        <span class="rs-l">Mode</span>
        <div class="rs-seg" role="group" aria-label="Reading layout mode">
          <button
            type="button"
            data-active={local.readerLayoutMode === 'page' ? '1' : '0'}
            onclick={() => commit({ ...local, readerLayoutMode: 'page' })}
          >Page</button>
          <button
            type="button"
            data-active={local.readerLayoutMode === 'paged_scroll' ? '1' : '0'}
            onclick={() => commit({ ...local, readerLayoutMode: 'paged_scroll' })}
          >Scroll</button>
          <button
            type="button"
            data-active={local.readerLayoutMode === 'continuous' ? '1' : '0'}
            onclick={() => commit({ ...local, readerLayoutMode: 'continuous' })}
          >Continuous</button>
        </div>
      </div>

      {#if local.readerLayoutMode === 'paged_scroll'}
        <div class="rs-row">
          <label class="rs-l" for="rs-wpp">Words / page</label>
          <input
            id="rs-wpp"
            type="number"
            min={WORDS_PER_PAGE_MIN}
            max={WORDS_PER_PAGE_MAX}
            step="50"
            value={local.wordsPerPage}
            oninput={(e) =>
              commit({
                ...local,
                wordsPerPage: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>
      {/if}

      <div class="rs-row">
        <span class="rs-l">Width</span>
        <div class="rs-seg" role="group" aria-label="Reading column width">
          <button
            type="button"
            data-active={local.readingWidth === 'narrow' ? '1' : '0'}
            onclick={() => commit({ ...local, readingWidth: 'narrow' })}
          >Narrow</button>
          <button
            type="button"
            data-active={local.readingWidth === 'medium' ? '1' : '0'}
            onclick={() => commit({ ...local, readingWidth: 'medium' })}
          >Medium</button>
          <button
            type="button"
            data-active={local.readingWidth === 'wide' ? '1' : '0'}
            onclick={() => commit({ ...local, readingWidth: 'wide' })}
          >Wide</button>
        </div>
      </div>
    </section>

    <section>
      <h3>Typography</h3>
      <div class="rs-row">
        <label class="rs-l" for="rs-font">Font</label>
        <select
          id="rs-font"
          value={local.fontFamily ?? ''}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            commit({ ...local, fontFamily: v === '' ? null : v });
          }}
        >
          {#each recommendedFonts as opt}
            <option value={opt ?? ''}>{opt ?? 'System default'}</option>
          {/each}
        </select>
      </div>

      <div class="rs-row">
        <label class="rs-l" for="rs-size">
          Size <span class="rs-val">{local.fontSize.toFixed(0)}pt</span>
        </label>
        <input
          id="rs-size"
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step="1"
          value={local.fontSize}
          oninput={(e) =>
            commit({
              ...local,
              fontSize: Number((e.target as HTMLInputElement).value),
            })}
        />
      </div>

      <div class="rs-row">
        <label class="rs-l" for="rs-line">
          Line spacing <span class="rs-val">{local.lineSpacing.toFixed(2)}</span>
        </label>
        <input
          id="rs-line"
          type="range"
          min={LINE_SPACING_MIN}
          max={LINE_SPACING_MAX}
          step="0.05"
          value={local.lineSpacing}
          oninput={(e) =>
            commit({
              ...local,
              lineSpacing: Number((e.target as HTMLInputElement).value),
            })}
        />
      </div>
    </section>

    <section>
      <h3>Highlight</h3>
      <div class="rs-row">
        <span class="rs-l">Style</span>
        <div class="rs-seg" role="group" aria-label="Highlight style">
          <button
            type="button"
            data-active={local.highlightStyle === 'background' ? '1' : '0'}
            onclick={() => commit({ ...local, highlightStyle: 'background' })}
          >Tint</button>
          <button
            type="button"
            data-active={local.highlightStyle === 'underline' ? '1' : '0'}
            onclick={() => commit({ ...local, highlightStyle: 'underline' })}
          >Underline</button>
          <button
            type="button"
            data-active={local.highlightStyle === 'colored_text' ? '1' : '0'}
            onclick={() => commit({ ...local, highlightStyle: 'colored_text' })}
          >Color</button>
        </div>
      </div>
    </section>

    <section>
      <h3>Romanization</h3>
      <div class="rs-row">
        <span class="rs-l">Show as</span>
        <div class="rs-seg" role="group" aria-label="Script preference">
          <button
            type="button"
            data-active={local.scriptPreference === 'native' ? '1' : '0'}
            onclick={() => commit({ ...local, scriptPreference: 'native' })}
          >Native</button>
          <button
            type="button"
            data-active={local.scriptPreference === 'native_with_romanization' ? '1' : '0'}
            onclick={() => commit({ ...local, scriptPreference: 'native_with_romanization' })}
          >Both</button>
          <button
            type="button"
            data-active={local.scriptPreference === 'romanization_only' ? '1' : '0'}
            onclick={() => commit({ ...local, scriptPreference: 'romanization_only' })}
          >Roman</button>
        </div>
      </div>
      <div class="rs-row">
        <label class="rs-l" for="rs-scheme">Scheme</label>
        <select
          id="rs-scheme"
          value={local.romanizationScheme}
          onchange={(e) =>
            commit({
              ...local,
              romanizationScheme: (e.target as HTMLSelectElement).value as RomanizationScheme,
            })}
        >
          {#each supportedRomanizations as scheme}
            <option value={scheme}>{scheme.toUpperCase()}</option>
          {/each}
        </select>
      </div>
    </section>

    <footer class="rs-foot">
      <button type="button" class="rs-reset" onclick={reset}>Reset to defaults</button>
      {#if saveError}
        <p class="rs-err" role="alert">Couldn't save: {saveError}</p>
      {/if}
    </footer>
  </div>
</Sheet>

<style>
  .rs {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 0.25rem 0 1rem;
  }
  .rs section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .rs h3 {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0;
    font-weight: 500;
  }
  .rs-row {
    display: grid;
    grid-template-columns: 7rem 1fr;
    align-items: center;
    gap: 0.6rem;
  }
  .rs-l {
    font-size: 0.85rem;
    color: var(--ink-2, var(--color-fg));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
  }
  .rs-val {
    font-family: var(--font-mono-display, var(--font-mono, monospace));
    font-size: 0.7rem;
    color: var(--ink-3, var(--color-fg-muted));
    font-feature-settings: 'tnum';
  }
  .rs-seg {
    display: flex;
    background: var(--card-2, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    overflow: hidden;
  }
  .rs-seg button {
    flex: 1;
    background: transparent;
    border: 0;
    padding: 0.4rem 0.55rem;
    font-size: 0.78rem;
    color: var(--ink-2, var(--color-fg));
    cursor: pointer;
  }
  .rs-seg button[data-active='1'] {
    background: var(--accent-soft, color-mix(in oklch, var(--accent, var(--color-accent)) 18%, transparent));
    color: var(--accent-ink, var(--color-fg));
    font-weight: 500;
  }
  input[type='range'] {
    width: 100%;
  }
  input[type='number'],
  select {
    width: 100%;
    padding: 0.35rem 0.5rem;
    border-radius: 5px;
    border: 1px solid var(--card-edge, var(--color-border));
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-size: 0.85rem;
  }
  .rs-foot {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .rs-reset {
    align-self: flex-start;
    background: transparent;
    border: 0;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
    padding: 0.2rem 0;
    cursor: pointer;
    text-decoration: underline;
  }
  .rs-err {
    margin: 0;
    color: var(--err, #b94545);
    font-size: 0.78rem;
  }
</style>
