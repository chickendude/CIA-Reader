<!--
  ScriptAwareInput (T-6.2a).

  A drop-in `<input>` replacement that lets the user type in either
  the native script for the language (Devanagari for hi/mr, Odia for
  or) or in Latin (ITRANS-flavored) and see live transliteration as
  they type. Used by:

    - T-6.2 correction modal (dictionary search)
    - T-6.3 new-lemma submission form
    - T-3.7 curator dictionary editor (when retrofitted)
    - T-3.12 dictionary browse search (when retrofitted)

  Props:

    - language          — drives the script + transliteration map
    - initialScript     — 'auto' | 'native' | 'romanization'
    - value             — controlled text in native script (NFC)
    - placeholder       — passthrough
    - onNativeChange    — fired with the NFC native string

  Behavior:

    - 'native' mode: typed text passes through untouched + NFC-normalizes.
    - 'romanization' mode: each keystroke runs `latinToNative()` and
      we render the native preview as a non-editable shadow. The
      latin draft remains in the input so the user can edit; on
      blur (or paste of native), we commit the native form to the
      input directly.
    - 'auto' mode: starts as 'romanization' but flips to 'native'
      the first time the user types a native-script character (or
      pastes one).
    - Paste handler: paste of native skips transliteration +
      NFC-normalizes; paste of latin runs the full transliteration.
    - The "show as" toggle button flips between 'native' and
      'romanization' mode without losing the text.

  IME composition: while `compositionstart`/`compositionend` is
  active we suspend transliteration so multi-keystroke IME input
  (e.g. macOS Devanagari keyboard) lands directly without our
  latin-rules interfering.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { LANGUAGES, type LanguageCode } from '@ciareader/shared-types';
  import { latinToNative, looksLikeNativeScript, nfc } from './transliterate.js';

  type Mode = 'native' | 'romanization';

  interface Props {
    language: LanguageCode;
    initialScript?: 'auto' | 'native' | 'romanization';
    value?: string;
    placeholder?: string;
    id?: string;
    name?: string;
    /** Fires with the native-script (NFC) representation. */
    onNativeChange?: (native: string) => void;
    /** Disables the "show as" toggle. Used in compact contexts. */
    hideToggle?: boolean;
    /** Test seam: override the transliteration function. Defaults
     *  to `latinToNative` from this module. */
    transliterate?: (lang: LanguageCode, latin: string) => string;
  }

  let {
    language,
    initialScript = 'auto',
    value = '',
    placeholder = '',
    id,
    name,
    onNativeChange,
    hideToggle = false,
    transliterate = latinToNative,
  }: Props = $props();

  // Resolve the mode. 'auto' starts as romanization but flips on the
  // first native input; user-initiated 'native' / 'romanization'
  // sticks through the lifetime of the component.
  let mode: Mode = $state(
    untrack(() => {
      if (initialScript === 'native') return 'native' as Mode;
      if (initialScript === 'romanization') return 'romanization' as Mode;
      return looksLikeNativeScript(value, language) ? ('native' as Mode) : ('romanization' as Mode);
    }),
  );

  // The `text` field is what the user sees in the input. In native
  // mode it equals the native-script value. In romanization mode it
  // is the user's latin draft and `nativePreview` carries the
  // transliterated render.
  let text: string = $state(
    untrack(() =>
      mode === 'native'
        ? nfc(value)
        : value && looksLikeNativeScript(value, language)
          ? nfc(value)
          : '',
    ),
  );
  // Romanization-mode shadow render.
  const nativePreview = $derived(
    mode === 'romanization' ? nfc(transliterate(language, text)) : '',
  );
  let composing = $state(false);

  function emitNative(native: string) {
    onNativeChange?.(nfc(native));
  }

  function onInput(e: Event) {
    const t = (e.target as HTMLInputElement).value;
    text = t;
    if (composing) return;
    if (mode === 'native') {
      emitNative(t);
      return;
    }
    // Romanization mode: if the user just typed a native char (e.g.
    // they switched IME), flip to native so the input stops trying
    // to re-transliterate latin.
    if (looksLikeNativeScript(t, language)) {
      mode = 'native';
      emitNative(t);
      return;
    }
    emitNative(transliterate(language, t));
  }

  function onCompositionStart() {
    composing = true;
  }
  function onCompositionEnd(e: CompositionEvent) {
    composing = false;
    onInput(e);
  }

  function onPaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData('text');
    if (!pasted) return;
    if (looksLikeNativeScript(pasted, language)) {
      // Native paste: skip transliteration, NFC-normalize.
      e.preventDefault();
      const native = nfc(pasted);
      text = native;
      mode = 'native';
      emitNative(native);
    }
    // Latin paste: let the input event handle it via the regular
    // transliteration path (no preventDefault).
  }

  function toggleMode() {
    if (mode === 'native') {
      // Going from native → romanization: we don't have a clean
      // reverse mapping, so we keep the native text in the buffer
      // and just show the romanization toggle as decorative. The
      // input still displays the native form.
      mode = 'romanization';
      return;
    }
    // Romanization → native: commit the transliterated form into
    // the input so the next edit happens in native script directly.
    text = nativePreview;
    mode = 'native';
    emitNative(text);
  }

  const langInfo = $derived(LANGUAGES[language]);
</script>

<div class="sai" data-mode={mode} data-language={language}>
  <input
    {id}
    {name}
    {placeholder}
    type="text"
    autocapitalize="off"
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    lang={language}
    dir="auto"
    value={text}
    oninput={onInput}
    oncompositionstart={onCompositionStart}
    oncompositionend={onCompositionEnd}
    onpaste={onPaste}
    data-testid="script-aware-input"
  />
  {#if mode === 'romanization' && nativePreview}
    <p class="sai-preview" aria-live="polite" data-testid="sai-preview">
      <span class="sai-preview-label">{langInfo.nativeName}:</span>
      <bdi>{nativePreview}</bdi>
    </p>
  {/if}
  {#if !hideToggle}
    <button
      type="button"
      class="sai-toggle"
      onclick={toggleMode}
      aria-pressed={mode === 'native'}
      aria-label="Toggle native / romanization input"
      title={mode === 'native'
        ? langInfo.script === 'Hebr'
          ? 'Switch to YIVO-style typing'
          : 'Switch to ITRANS-style typing'
        : 'Switch to native script'}
    >
      {mode === 'native'
        ? 'Aa'
        : langInfo.script === 'Deva'
          ? 'देव'
          : langInfo.script === 'Orya'
            ? 'ଓଡ଼'
            : langInfo.script === 'Hebr'
              ? 'ייִ'
              : 'A'}
    </button>
  {/if}
</div>

<style>
  .sai {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
    align-items: center;
  }
  .sai input {
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-size: 0.95rem;
    font-family: var(--font-serif-dev, var(--font-serif));
  }
  .sai input:focus {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 1px;
  }
  .sai-toggle {
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    font-family: var(--font-serif-dev, var(--font-serif));
    color: var(--ink-2, var(--color-fg));
    cursor: pointer;
  }
  .sai-toggle[aria-pressed='true'] {
    background: var(--accent-soft, color-mix(in oklch, var(--accent, var(--color-accent)) 18%, transparent));
  }
  .sai-preview {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
    font-family: var(--font-serif-dev, var(--font-serif));
  }
  .sai-preview-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-4, var(--color-fg-subtle));
    margin-right: 0.35rem;
  }
</style>
