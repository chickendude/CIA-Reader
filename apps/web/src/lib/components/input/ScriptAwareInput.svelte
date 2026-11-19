<!--
  Converts typed or pasted text to the selected script. Keep the original input available while
  the user is composing a character.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import TextField from './TextField.svelte';
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
  let text = $state(untrack(() => nfc(value)));
  // Romanization-mode shadow render.
  const nativePreview = $derived(
    mode === 'romanization' ? nfc(transliterate(language, text)) : '',
  );
  let composing = $state(false);

  function emitNative(native: string) {
    onNativeChange?.(nfc(native));
  }

  function updateText(t: string) {
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
    updateText((e.target as HTMLInputElement).value);
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
  <TextField
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
    bind:value={() => text, updateText}
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
    <Button
      type="button"
      variant="toggle"
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
    </Button>
  {/if}
</div>

<style>
  .sai {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    font: 0.95rem var(--font-serif-dev, var(--font-serif));
    gap: 0.4rem;
    align-items: center;
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
