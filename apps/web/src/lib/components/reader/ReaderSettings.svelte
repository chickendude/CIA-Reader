<!--
  Apply settings immediately so readers can preview them. Signed-in readers also save their
  choices for this language.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import SegmentedControl from '$lib/components/input/SegmentedControl.svelte';
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
    hideMobileArrows?: boolean;
    onMobileArrowsChange?: (hidden: boolean) => void;
    showRomanization?: boolean;
    onRomanizationChange?: (show: boolean) => void;
    processingTools?: import('svelte').Snippet;
    onClose: () => void;
    language: LanguageCode;
    settings: ReaderSettings;
    /** Called on every change with the next settings (live preview). */
    onChange: (next: ReaderSettings) => void;
    /** When true, settings persist via the API; when false (anon
     *  reads of an official text) we still live-preview but skip the
     *  network call. */
    canPersist?: boolean;
    isAdmin?: boolean;
    flagUndefined?: boolean;
    onFlagUndefinedChange?: (on: boolean) => void;
    /** Override hook for tests. Real callers omit this. */
    fetcher?: typeof fetch;
  }

  let {
    open,
    hideMobileArrows = false,
    onMobileArrowsChange,
    showRomanization,
    onRomanizationChange,
    processingTools,
    onClose,
    language,
    settings,
    onChange,
    canPersist = true,
    isAdmin = false,
    flagUndefined = false,
    onFlagUndefinedChange,
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

  const displayedScript = $derived(showRomanization === false ? 'native'
    : showRomanization && local.scriptPreference === 'native' ? 'native_with_romanization' : local.scriptPreference);

  function selectScript(scriptPreference: ReaderSettings['scriptPreference']) {
    onRomanizationChange?.(scriptPreference !== 'native');
    commit({ ...local, scriptPreference });
  }

  function reset() {
    onMobileArrowsChange?.(false);
    onRomanizationChange?.(DEFAULT_READER_SETTINGS.scriptPreference !== 'native');
    commit({ ...DEFAULT_READER_SETTINGS });
  }
</script>

<Sheet {open} {onClose} title="Reader settings" width={400} dimmed={false}>
  <div class="rs" data-testid="reader-settings">
    <section>
      <h3>Layout</h3>
      <div class="rs-row">
        <span class="rs-l">Mode</span>
        <SegmentedControl label="Reading layout mode" value={local.readerLayoutMode}
            options={[{ value: 'page', label: 'Page' }, { value: 'paged_scroll', label: 'Scroll' }, { value: 'continuous', label: 'Continuous' }]}
            onChange={(readerLayoutMode) => commit({ ...local, readerLayoutMode })} />
      </div>

      {#if onMobileArrowsChange}
        <div class="rs-row rs-mobile-arrows">
          <span class="rs-l">Page arrows</span>
          <SegmentedControl label="Page arrows" value={hideMobileArrows}
            options={[{ value: false, label: 'Show' }, { value: true, label: 'Hide' }]}
            onChange={(hidden) => onMobileArrowsChange?.(hidden)} />
        </div>
      {/if}

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
        <SegmentedControl label="Reading column width" value={local.readingWidth}
            options={[{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }]}
            onChange={(readingWidth) => commit({ ...local, readingWidth })} />
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
      <div class="rs-row rs-highlight-style">
        <span class="rs-l">Style</span>
        <SegmentedControl label="Highlight style" value={local.highlightStyle}
            options={[{ value: 'none', label: 'None' }, { value: 'background', label: 'Tint' }, { value: 'underline', label: 'Underline' }, { value: 'colored_text', label: 'Color' }]}
            onChange={(highlightStyle) => commit({ ...local, highlightStyle })} />
      </div>
      <div class="rs-row">
        <span class="rs-l">Learning words</span>
        <SegmentedControl label="Highlight learning words" value={local.highlightLearning}
            options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]}
            onChange={(highlightLearning) => commit({ ...local, highlightLearning })} />
      </div>
    </section>

    <!-- Latin-script languages (e.g. Basque) have no romanization layer, so
         the whole section — script preference + scheme picker — is hidden when
         the registry declares no supported romanizations. -->
    {#if supportedRomanizations.length > 0}
    <section>
      <h3>Romanization</h3>
      <div class="rs-row">
        <span class="rs-l">Show as</span>
        <SegmentedControl label="Script preference" value={displayedScript}
            options={[{ value: 'native', label: 'Native' }, { value: 'native_with_romanization', label: 'Both' }, { value: 'romanization_only', label: 'Roman' }]}
            onChange={selectScript} />
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
    {/if}

    {#if isAdmin}
    <section data-testid="rs-admin">
      <h3>Admin</h3>
      <div class="rs-row">
        <span class="rs-l">Undefined words</span>
        <SegmentedControl label="Highlight words with no definition" value={flagUndefined}
            options={[{ value: true, label: 'Flag' }, { value: false, label: 'Off' }]}
            onChange={(on) => onFlagUndefinedChange?.(on)} />
      </div>
      <p class="rs-hint">Tints words with no definition yet so you can spot gaps.</p>
    </section>
    {/if}

    {#if processingTools}{@render processingTools()}{/if}

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
  @media (min-width: 640px) {
    .rs-row.rs-mobile-arrows { display: none; }
  }
  .rs-row {
    display: grid;
    grid-template-columns: 7rem 1fr;
    align-items: center;
    gap: 0.6rem;
  }
  @media (max-width: 380px) {
    .rs-highlight-style { grid-template-columns: 1fr; }
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
  .rs-hint {
    margin: 0;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.72rem;
    line-height: 1.4;
  }
</style>
