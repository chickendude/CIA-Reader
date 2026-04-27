<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import type { ActionData, PageData } from './$types';

  let {
    data,
    form,
  }: { data: PageData; form: ActionData } = $props();

  // Initial form state, prefilled from the last failed submission's
  // echoed values so the user doesn't have to re-type their paste. We
  // wrap the prop reads in `untrack` so Svelte 5 doesn't flag them as
  // a reactivity mistake — we deliberately want a one-time snapshot,
  // not a binding to the prop.
  let language = $state(
    untrack(() => form?.values?.language ?? data.languages[0]!.code),
  );
  let title = $state(untrack(() => form?.values?.title ?? ''));
  let body = $state(untrack(() => form?.values?.body ?? ''));
  // Tracks whether the body originated from a file drop; controls
  // which byte cap applies and gets posted to the form action so the
  // server picks the right service (createTxtText vs createPastedText).
  // Echoed back on a failed submit so the user keeps their state.
  let sourceType = $state<'paste' | 'txt'>(
    untrack(() => (form?.values?.sourceType === 'txt' ? 'txt' : 'paste')),
  );
  let dropMessage = $state<string | null>(null);

  // The applicable byte cap depends on the source type — paste paths
  // are tighter than .txt paths.
  const maxBodyBytes = $derived(
    sourceType === 'txt' ? data.limits.maxTxtBytes : data.limits.maxPasteBytes,
  );

  // Cheap UTF-8 byte count for the live counter — `TextEncoder` exists
  // in every browser we care about. Match the server's caps so we can
  // disable submit before hitting the wire.
  const byteCount = $derived(new TextEncoder().encode(body).byteLength);
  const overLimit = $derived(byteCount > maxBodyBytes);

  async function handleFileDrop(file: File) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.epub')) {
      dropMessage =
        `EPUB '${file.name}' selected — upload it via the EPUB section below.`;
      return;
    }
    if (!lower.endsWith('.txt')) {
      dropMessage = `Unsupported file type: ${file.name}`;
      return;
    }
    if (file.size > data.limits.maxTxtBytes) {
      dropMessage = `File is too large (max ${(
        data.limits.maxTxtBytes / 1_000_000
      ).toLocaleString()} MB).`;
      return;
    }
    try {
      const text = await file.text();
      body = text;
      sourceType = 'txt';
      if (!title) title = file.name.replace(/\.txt$/i, '');
      dropMessage = `Loaded ${file.name} (${(file.size / 1000).toFixed(1)} KB).`;
    } catch {
      dropMessage = `Failed to read ${file.name}.`;
    }
  }

  // The EPUB upload uses its own form action (multipart) rather than
  // re-using the JSON paste/txt path. This separation keeps the JSON
  // validator schema strict and avoids dragging EPUB-specific concerns
  // (file picker, multipart, parser-driven errors) into the paste UI.
  let epubLanguage = $state(
    untrack(() => form?.values?.language ?? data.languages[0]!.code),
  );
  let epubTitle = $state('');
  let epubFileName = $state<string | null>(null);
  let epubFileSize = $state(0);

  function onEpubPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      epubFileName = null;
      epubFileSize = 0;
      return;
    }
    epubFileName = file.name;
    epubFileSize = file.size;
    if (!epubTitle) epubTitle = file.name.replace(/\.epub$/i, '');
  }

  const epubMessage = $derived(
    form && 'section' in form && form.section === 'epub' && !form.ok
      ? form.message
      : null,
  );

  function onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) void handleFileDrop(file);
  }

  function onFilePick(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (file) void handleFileDrop(file);
  }
</script>

<svelte:head>
  <title>Upload text — CIA Reader</title>
</svelte:head>

<div class="page">
  <header>
    <h1>Upload a text</h1>
    <p class="sub">
      Paste a passage or drop a <code>.txt</code> file. Texts are private to
      your account by default — sharing options come later.
    </p>
  </header>

  {#if form && !form.ok}
    <p class="err" role="alert">{form.message}</p>
  {/if}

  <form method="post" use:enhance class="stack">
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
      Title
      <input
        name="title"
        bind:value={title}
        maxlength={data.limits.maxTitleLength}
        required
        placeholder="e.g. Chapter 1 — A short story"
      />
    </label>

    <div
      class="dropzone"
      ondragover={onDragOver}
      ondrop={onDrop}
      role="region"
      aria-label="File drop zone"
    >
      <p>
        Drag &amp; drop a <code>.txt</code> file here, or
        <label class="file-pick">
          <input type="file" accept=".txt,.epub" onchange={onFilePick} />
          choose a file
        </label>
        .
      </p>
      {#if dropMessage}
        <p class="drop-msg">{dropMessage}</p>
      {/if}
    </div>

    <input type="hidden" name="sourceType" value={sourceType} />

    <label>
      Body
      <textarea
        name="body"
        bind:value={body}
        rows="14"
        required
        placeholder="Paste your text here in the language's native script."
      ></textarea>
      <span class="counter" class:over={overLimit}>
        {byteCount.toLocaleString()} / {maxBodyBytes.toLocaleString()} bytes
        <span class="src">· {sourceType === 'txt' ? '.txt upload' : 'paste'}</span>
        {#if sourceType === 'txt'}
          <button
            type="button"
            class="reset"
            onclick={() => {
              sourceType = 'paste';
              dropMessage = null;
            }}
          >
            Treat as paste
          </button>
        {/if}
      </span>
    </label>

    <button type="submit" disabled={overLimit}>Upload</button>
  </form>

  <hr class="divider" />

  <section class="epub-section">
    <h2>Upload an EPUB</h2>
    <p class="sub">
      Chapters are imported as authored — the EPUB's own table of
      contents drives the chapter list. Up to {(
        data.limits.maxEpubBytes / 1_000_000
      ).toLocaleString()} MB.
    </p>

    {#if epubMessage}
      <p class="err" role="alert">{epubMessage}</p>
    {/if}

    <form
      method="post"
      action="?/epub"
      enctype="multipart/form-data"
      use:enhance
      class="stack"
    >
      <label>
        Language
        <select name="language" bind:value={epubLanguage} required>
          {#each data.languages as lang (lang.code)}
            <option value={lang.code}>
              {lang.displayName} ({lang.nativeName})
            </option>
          {/each}
        </select>
      </label>

      <label>
        Title (optional — defaults to the filename)
        <input
          name="title"
          bind:value={epubTitle}
          maxlength={data.limits.maxTitleLength}
          placeholder="e.g. The Far Pavilions"
        />
      </label>

      <label>
        EPUB file
        <input
          type="file"
          name="file"
          accept=".epub,application/epub+zip"
          required
          onchange={onEpubPick}
        />
      </label>

      {#if epubFileName}
        <p class="muted">
          Selected: <code>{epubFileName}</code>
          ({(epubFileSize / 1000).toFixed(1)} KB)
        </p>
      {/if}

      <button type="submit" disabled={!epubFileName}>Upload EPUB</button>
    </form>
  </section>
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
  .counter .reset {
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
  .divider {
    border: 0;
    border-top: 1px solid var(--color-border);
    margin: 2rem 0 1.25rem;
  }
  .epub-section h2 {
    margin: 0 0 0.4rem;
    font-size: 1.2rem;
  }
  .muted {
    color: var(--color-fg-muted);
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
</style>
