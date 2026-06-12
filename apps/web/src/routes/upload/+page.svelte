<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import type { ActionData, PageData } from './$types';

  let {
    data,
    form,
  }: { data: PageData; form: ActionData } = $props();

  // Initial state seeded from any failed-submit echo (paste-action
  // values), so the user keeps their work after a validation bounce.
  let language = $state(
    untrack(() => form?.values?.language ?? data.languages[0]!.code),
  );
  let title = $state(untrack(() => form?.values?.title ?? ''));
  let body = $state(untrack(() => form?.values?.body ?? ''));

  // The active "mode" picks which form action runs and which fields
  // get submitted. Drag/drop or file-pick flips it; the user can flip
  // back manually too.
  //
  // 'paste' + 'txt' both submit to ?/paste — the difference is the
  // byte cap (10MB vs 1MB) and the hidden sourceType marker.
  // 'epub' submits to ?/epub. 'zip' submits to ?/zip.
  let mode = $state<'paste' | 'txt' | 'epub' | 'zip'>(
    untrack(() => (form?.values?.sourceType === 'txt' ? 'txt' : 'paste')),
  );
  let pickedFileName = $state<string | null>(null);
  let pickedFileSize = $state(0);
  let dropMessage = $state<string | null>(null);
  // The actual File object the user dropped or picked. Held separately
  // so drag-and-drop (which can't directly mutate the <input>'s
  // FileList) and the file picker behave identically — `use:enhance`'s
  // submit callback below copies this into FormData before submission.
  let pickedFile = $state<File | null>(null);

  // The action attribute changes with mode so a single <form> can
  // dispatch to three different handlers.
  const formAction = $derived(
    mode === 'epub'
      ? '?/epub'
      : mode === 'zip'
        ? '?/zip'
        : '?/paste',
  );

  const isTextMode = $derived(mode === 'paste' || mode === 'txt');
  const isFileMode = $derived(mode === 'epub' || mode === 'zip');

  const maxBodyBytes = $derived(
    mode === 'txt' ? data.limits.maxTxtBytes : data.limits.maxPasteBytes,
  );
  const byteCount = $derived(new TextEncoder().encode(body).byteLength);
  const overLimit = $derived(byteCount > maxBodyBytes);

  // True from the moment the form is submitted until the server's
  // response lands (or a redirect-navigation completes). Locks the
  // submit button so a double-click can't fire two uploads and a
  // big EPUB doesn't look frozen. Declared up here so the derivation
  // below can see it.
  let uploading = $state(false);

  const submitDisabled = $derived(
    uploading || (isTextMode ? overLimit : !pickedFileName),
  );

  // Used to force-remount the <input type="file"> when we reset back
  // to paste — clears any FileList the input was carrying so a stale
  // EPUB doesn't ride along with a subsequent paste submission.
  let filePickerKey = $state(0);

  async function handleFile(file: File) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.epub')) {
      mode = 'epub';
      pickedFile = file;
      pickedFileName = file.name;
      pickedFileSize = file.size;
      if (!title) title = file.name.replace(/\.epub$/i, '');
      dropMessage = null;
      return;
    }
    if (lower.endsWith('.zip')) {
      mode = 'zip';
      pickedFile = file;
      pickedFileName = file.name;
      pickedFileSize = file.size;
      if (!title) title = file.name.replace(/\.zip$/i, '');
      dropMessage = null;
      return;
    }
    if (lower.endsWith('.txt')) {
      if (file.size > data.limits.maxTxtBytes) {
        dropMessage = `File is too large (max ${(
          data.limits.maxTxtBytes / 1_000_000
        ).toLocaleString()} MB).`;
        return;
      }
      try {
        body = await file.text();
        mode = 'txt';
        pickedFile = null;
        pickedFileName = null;
        pickedFileSize = 0;
        if (!title) title = file.name.replace(/\.txt$/i, '');
        dropMessage = `Loaded ${file.name} (${(file.size / 1000).toFixed(1)} KB).`;
      } catch {
        dropMessage = `Failed to read ${file.name}.`;
      }
      return;
    }
    dropMessage = `Unsupported file type: ${file.name}`;
  }

  // use:enhance contract: the outer callback fires before the
  // request goes out; the inner callback fires once the response is
  // back. We:
  //   - Copy the dropped/picked File into FormData (drag-and-drop
  //     never touches the underlying <input>'s FileList, so without
  //     this the server sees an empty file slot).
  //   - Flip `uploading` true before send, false after the response.
  //     On a 303-redirect success, `update()` runs SvelteKit's
  //     navigation, which mounts a fresh page where this state no
  //     longer matters.
  function onSubmit({ formData }: { formData: FormData }) {
    if (isFileMode && pickedFile) {
      formData.set('file', pickedFile, pickedFile.name);
    }
    uploading = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      try {
        await update();
      } finally {
        uploading = false;
      }
    };
  }

  // Active drag-target highlight. Counts enter/leave events so that
  // hovering over child elements (the file-pick label, the inner
  // <p>) doesn't flicker the highlight off and on.
  let dragDepth = $state(0);
  const dragActive = $derived(dragDepth > 0);

  function onDragEnter(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragDepth += 1;
  }
  function onDragLeave(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
  }
  function onDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    // Hint to the browser that this is a copy gesture so the cursor
    // updates appropriately.
    event.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragDepth = 0;
    const file = event.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  }

  function onFilePick(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (file) void handleFile(file);
  }

  function resetToPaste() {
    mode = 'paste';
    pickedFile = null;
    pickedFileName = null;
    pickedFileSize = 0;
    dropMessage = null;
    // Remount the file input to drop any FileList it was carrying.
    filePickerKey += 1;
  }

  const errorMessage = $derived(form && !form.ok ? form.message : null);

  const submitLabel = $derived(
    uploading
      ? mode === 'epub'
        ? 'Uploading EPUB…'
        : mode === 'zip'
          ? 'Uploading ZIP…'
          : 'Uploading…'
      : mode === 'epub'
        ? 'Upload EPUB'
        : mode === 'zip'
          ? 'Upload ZIP'
          : 'Upload text',
  );
</script>

<svelte:head>
  <title>Upload — CIA Reader</title>
</svelte:head>

<div class="page">
  <header>
    <h1>Upload a text</h1>
    <p class="sub">
      Paste a passage, drop a <code>.txt</code> file, or upload an
      <code>.epub</code> or a <code>.zip</code> of
      <code>.txt</code> files to import as a chapter-book collection.
      Texts are private to your account by default.
    </p>
  </header>

  {#if errorMessage}
    <p class="err" role="alert">{errorMessage}</p>
  {/if}

  <form
    method="post"
    action={formAction}
    enctype="multipart/form-data"
    use:enhance={onSubmit}
    class="stack"
    class:drag-active={dragActive}
    ondragenter={onDragEnter}
    ondragleave={onDragLeave}
    ondragover={onDragOver}
    ondrop={onDrop}
  >
    <label>
      Language
      <select name="language" bind:value={language} required>
        {#each data.languages as lang (lang.code)}
          <option value={lang.code}>
            {lang.displayName} ({lang.nativeName})
          </option>
        {/each}
      </select>
    </label>

    <label>
      Title {#if isFileMode}<span class="hint">(optional)</span>{/if}
      <!-- dir=auto: direction follows the typed content, so a Yiddish
           (RTL Hebrew-script) title lays out right-to-left while Indic
           titles stay LTR. Same on the body textarea below, where the
           browser resolves each line independently — mixed-direction
           documents (Yiddish text with English credits) render every
           paragraph in its natural direction. -->
      <input
        name="title"
        dir="auto"
        bind:value={title}
        maxlength={data.limits.maxTitleLength}
        required={isTextMode}
        placeholder={isFileMode
          ? 'Defaults to the filename'
          : 'e.g. Chapter 1 — A short story'}
      />
    </label>

    <div
      class="dropzone"
      class:active={dragActive}
      role="region"
      aria-label="File drop zone"
    >
      <p>
        Drag &amp; drop a <code>.txt</code>, <code>.epub</code>, or
        <code>.zip</code> file, or
        <label class="file-pick">
          {#key filePickerKey}
            <input
              type="file"
              name="file"
              accept=".txt,.epub,.zip"
              onchange={onFilePick}
            />
          {/key}
          choose a file
        </label>
        .
      </p>
      {#if dropMessage}
        <p class="drop-msg">{dropMessage}</p>
      {/if}
      {#if isFileMode && pickedFileName}
        <p class="muted">
          Selected: <code>{pickedFileName}</code>
          ({(pickedFileSize / 1000).toFixed(1)} KB) — will be imported
          as {mode === 'epub' ? 'an EPUB chapter book' : 'a ZIP chapter book'}.
          <button type="button" class="reset" onclick={resetToPaste}>
            Switch to paste
          </button>
        </p>
      {/if}
    </div>

    {#if isTextMode}
      <input type="hidden" name="sourceType" value={mode} />
      <label>
        Body
        <textarea
          name="body"
          dir="auto"
          bind:value={body}
          rows="14"
          required
          placeholder="Paste your text here in the language's native script."
        ></textarea>
        <span class="counter" class:over={overLimit}>
          {byteCount.toLocaleString()} / {maxBodyBytes.toLocaleString()} bytes
          <span class="src">· {mode === 'txt' ? '.txt upload' : 'paste'}</span>
          {#if mode === 'txt'}
            <button
              type="button"
              class="reset"
              onclick={() => {
                mode = 'paste';
                dropMessage = null;
              }}
            >
              Treat as paste
            </button>
          {/if}
        </span>
      </label>
    {/if}

    <button
      type="submit"
      disabled={submitDisabled}
      aria-busy={uploading}
    >{submitLabel}</button>
  </form>
</div>

<style>
  .page {
    max-width: 42rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  header h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
  }
  .sub {
    color: var(--color-fg-muted);
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  form label {
    display: block;
    margin-bottom: 0.75rem;
    font-size: 0.9rem;
  }
  form input,
  form textarea,
  form select {
    display: block;
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem 0.6rem;
    font: inherit;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    min-height: 44px;
  }
  form textarea {
    min-height: 12rem;
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95rem;
  }
  .stack > * {
    margin-bottom: 0.75rem;
  }
  form button {
    min-height: 44px;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  form button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .dropzone {
    border: 2px dashed var(--color-border);
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
    color: var(--color-fg-muted);
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
    transition:
      border-color 120ms ease,
      background-color 120ms ease,
      color 120ms ease;
  }
  /* Active drag-target state — fires when a file is being dragged
     anywhere over the form (the form is the drop target so the
     textarea also accepts files). Solid accent border + a very
     light tint so users see exactly where to release, but text
     keeps full WCAG AA contrast against the (mostly unchanged)
     page-surface background. `--accent-ink` is paired with a solid
     accent FILL only — never use it on a tinted-on-page surface
     where the background is essentially the page color. */
  .dropzone.active {
    border-color: var(--accent, var(--color-accent));
    border-style: solid;
    background: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 6%,
      transparent
    );
    color: var(--ink, var(--color-fg));
  }
  .dropzone.active code {
    color: var(--ink, var(--color-fg));
  }
  /* Mirror the highlight on the textarea: just the accent border,
     no bg tint. Tinting the textarea bg even slightly makes the
     ink-on-paper contrast harder to hit in dark mode. */
  form.drag-active textarea {
    border-color: var(--accent, var(--color-accent));
  }
  .dropzone p {
    margin: 0.25rem 0;
  }
  .file-pick {
    color: var(--color-accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .file-pick input {
    display: none;
  }
  .drop-msg {
    margin-top: 0.5rem;
    color: var(--color-fg);
  }
  .counter {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: var(--color-fg-muted);
  }
  .counter.over {
    color: #b03131;
    font-weight: 600;
  }
  .counter .src {
    margin-left: 0.25rem;
    color: var(--color-fg-muted);
  }
  .counter .reset,
  .muted .reset {
    margin-left: 0.5rem;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-fg-muted);
    padding: 0 0.5rem;
    min-height: 0;
    font-size: 0.75rem;
    line-height: 1.6;
    cursor: pointer;
  }
  .err {
    color: #b03131;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
  }
  .muted {
    color: var(--color-fg-muted);
    font-size: 0.85rem;
    margin: 0.5rem 0 0;
  }
  .hint {
    color: var(--color-fg-muted);
    font-weight: normal;
    font-size: 0.85em;
  }
</style>
