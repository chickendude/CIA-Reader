<script lang="ts">
  import { enhance } from '$app/forms';
  import ScanCropPane from '$lib/components/moderation/ScanCropPane.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type Crop = { x: number; y: number; w: number; h: number };
  type SenseRow = { translationId: string; body: string; lang: string };

  // Local editable state, seeded from the draft. Prev/next navigation
  // stays on this route (only the param changes), so the component is
  // NOT remounted — the $effect reseeds whenever the loaded lemma
  // changes, discarding in-progress edits for the previous entry (they
  // were either verified or deliberately skipped).
  let headword = $state('');
  let pos = $state('');
  let senses = $state<SenseRow[]>([]);
  let crop = $state<Crop | null>(null);
  let seededFor = $state('');
  $effect(() => {
    if (data.lemma.id === seededFor) return;
    seededFor = data.lemma.id;
    headword = data.lemma.headword;
    pos = data.lemma.pos;
    senses = data.senses.map((s) => ({
      translationId: s.id,
      body: s.body,
      lang: s.targetLanguage ?? 'en',
    }));
    crop = data.savedCrop ?? data.proposal?.crop ?? null;
  });

  function addSense() {
    senses = [...senses, { translationId: '', body: '', lang: 'en' }];
  }
  function removeSense(i: number) {
    senses = senses.filter((_, idx) => idx !== i);
  }
  function moveSense(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= senses.length) return;
    const copy = [...senses];
    const [row] = copy.splice(i, 1);
    copy.splice(j, 0, row!);
    senses = copy;
  }
</script>

<svelte:head>
  <title>Transcribe {data.lemma.headword} — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header>
    <nav class="crumbs">
      <a href={`/moderation/transcribe/${data.slug}`}>← {data.citation}</a>
    </nav>
    <div class="headrow">
      <h1>{data.lemma.headword}</h1>
      {#if data.lemma.curatorLocked}
        <span class="badge verified">verified</span>
      {:else}
        <span class="badge draft">draft</span>
      {/if}
      <span class="nav-links">
        {#if data.prevId}
          <a href={`/moderation/transcribe/${data.slug}/${data.prevId}`}>← prev</a>
        {/if}
        {#if data.nextId}
          <a href={`/moderation/transcribe/${data.slug}/${data.nextId}`}>next →</a>
        {/if}
      </span>
    </div>
    <p class="meta">{data.lemma.sourceId}</p>
  </header>

  {#if form && 'message' in form && form.message}
    <p class="error" role="alert">{form.message}</p>
  {/if}
  {#if data.ocrWarning}
    <p class="warn">{data.ocrWarning}</p>
  {/if}

  {#if !data.scanPage}
    <section class="no-scan">
      <p class="warn">
        No scan page resolved for this entry. Ingest the volume
        (<code>pnpm scan:ingest {data.slug} …</code>) or point at a page
        manually:
      </p>
      <form method="GET">
        <label for="page-input">Printed page:</label>
        <input id="page-input" name="page" type="number" min="1" />
        <button type="submit">Load page</button>
      </form>
    </section>
  {:else}
    <div class="workbench">
      <section class="scan">
        <h2>
          Scan — printed page {data.scanPage.printedPage ?? '?'}
          {#if data.proposal && !data.savedCrop}
            <span class="meta">
              (crop auto-proposed, confidence
              {Math.round(data.proposal.confidence * 100)}% — adjust if
              wrong)
            </span>
          {/if}
        </h2>
        <ScanCropPane
          imageUrl={data.scanPage.imageUrl}
          alt={`Scan of printed page ${data.scanPage.printedPage}`}
          bind:crop
        />
        <form method="GET" class="repoint">
          <label for="repoint-input">Wrong page? Load printed page:</label>
          <input id="repoint-input" name="page" type="number" min="1" />
          <button type="submit">Load</button>
        </form>
      </section>

      <form
        class="editor"
        method="POST"
        action="?/verify"
        use:enhance
      >
        <input type="hidden" name="scanPageId" value={data.scanPage.id} />
        <input type="hidden" name="nextId" value={data.nextId ?? ''} />
        <input type="hidden" name="senseCount" value={senses.length} />
        <input type="hidden" name="crop-x" value={crop?.x ?? ''} />
        <input type="hidden" name="crop-y" value={crop?.y ?? ''} />
        <input type="hidden" name="crop-w" value={crop?.w ?? ''} />
        <input type="hidden" name="crop-h" value={crop?.h ?? ''} />

        <div class="cols">
          <section class="col">
            <h2>Headword ({data.language})</h2>
            <p class="meta">
              Type exactly what the printed entry shows — the draft came
              from DSAL's transcription; the scan is the authority.
            </p>
            <label for="hw-input">Headword</label>
            <input
              id="hw-input"
              name="headword"
              class="hw"
              bind:value={headword}
              lang={data.language}
              autocomplete="off"
              spellcheck="false"
            />
            <label for="pos-input">POS</label>
            <input id="pos-input" name="pos" bind:value={pos} />
          </section>

          <section class="col">
            <h2>Senses (English / native)</h2>
            {#each senses as sense, i (i)}
              <div class="sense">
                <input
                  type="hidden"
                  name={`sense-${i}-id`}
                  value={sense.translationId}
                />
                <textarea
                  name={`sense-${i}-body`}
                  rows="3"
                  bind:value={sense.body}
                ></textarea>
                <div class="sense-tools">
                  <select name={`sense-${i}-lang`} bind:value={sense.lang}>
                    <option value="en">en</option>
                    <option value={data.language}>{data.language}</option>
                  </select>
                  <button type="button" onclick={() => moveSense(i, -1)}>↑</button>
                  <button type="button" onclick={() => moveSense(i, 1)}>↓</button>
                  <button type="button" onclick={() => removeSense(i)}>
                    remove
                  </button>
                </div>
              </div>
            {/each}
            <button type="button" class="add" onclick={addSense}>
              + Add sense
            </button>
            {#if data.scanPage.ocrStatus === 'ok' && data.scanPage.ocrText}
              <details>
                <summary>Page OCR text (copy source)</summary>
                <pre class="ocr">{data.scanPage.ocrText}</pre>
              </details>
            {/if}
          </section>
        </div>

        <div class="actions">
          <input
            name="reason"
            placeholder="Note (optional, goes to the audit log)"
          />
          <button type="submit" class="verify" disabled={!crop}>
            {crop ? 'Verify & next' : 'Draw the entry crop to verify'}
          </button>
        </div>
      </form>
    </div>

    <details class="flag">
      <summary>Flag a problem with this entry</summary>
      <form method="POST" action="?/flag" use:enhance>
        <input type="hidden" name="scanPageId" value={data.scanPage.id} />
        <input type="hidden" name="nextId" value={data.nextId ?? ''} />
        <label for="flag-note">What's wrong?</label>
        <input
          id="flag-note"
          name="note"
          required
          placeholder="e.g. scan unreadable, draft doesn't match any entry"
        />
        <button type="submit">Flag & next</button>
      </form>
    </details>

    <details class="flag">
      <summary>Add an entry the draft import missed (this page)</summary>
      <form method="POST" action="?/createEntry" use:enhance>
        <input
          type="hidden"
          name="printedPage"
          value={data.scanPage.printedPage ?? ''}
        />
        <label for="new-hw">Headword</label>
        <input id="new-hw" name="headword" lang={data.language} required />
        <label for="new-pos">POS</label>
        <input id="new-pos" name="pos" value="X" />
        <label for="new-body">Senses (one per line)</label>
        <textarea id="new-body" name="body" rows="3" required></textarea>
        <input name="reason" placeholder="Note (optional)" />
        <button type="submit">Create entry</button>
      </form>
    </details>
  {/if}
</div>

<style>
  .page {
    max-width: 90rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }
  .crumbs a {
    color: var(--text-secondary, #444);
    text-decoration: none;
  }
  .headrow {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }
  .headrow h1 {
    margin: 0.25rem 0;
  }
  .nav-links {
    margin-left: auto;
    display: flex;
    gap: 0.75rem;
  }
  .badge {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    border: 1px solid;
  }
  .badge.verified {
    color: var(--success-text, #14532d);
    border-color: currentColor;
  }
  .badge.draft {
    color: var(--warning-text, #92400e);
    border-color: currentColor;
  }
  .meta {
    color: var(--text-secondary, #444);
    font-size: 0.85rem;
  }
  .error {
    color: var(--error-text, #991b1b);
    border: 1px solid currentColor;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
  .warn {
    color: var(--warning-text, #92400e);
  }
  .workbench {
    display: grid;
    grid-template-columns: minmax(24rem, 1.2fr) 1fr;
    gap: 1.25rem;
    align-items: start;
  }
  @media (max-width: 70rem) {
    .workbench {
      grid-template-columns: 1fr;
    }
  }
  .scan h2,
  .col h2 {
    font-size: 0.95rem;
    margin: 0 0 0.5rem;
  }
  .repoint {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.5rem;
    font-size: 0.85rem;
  }
  .repoint input {
    width: 6rem;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(14rem, 1fr) minmax(18rem, 1.4fr);
    gap: 1.25rem;
  }
  @media (max-width: 50rem) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .col label {
    display: block;
    margin-top: 0.6rem;
    font-size: 0.85rem;
    color: var(--text-secondary, #444);
  }
  .col input,
  .sense textarea {
    width: 100%;
    box-sizing: border-box;
  }
  .hw {
    font-size: 1.4rem;
  }
  .sense {
    margin-bottom: 0.75rem;
  }
  .sense-tools {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.25rem;
  }
  .add {
    margin-bottom: 0.75rem;
  }
  .ocr {
    max-height: 16rem;
    overflow: auto;
    white-space: pre-wrap;
    font-size: 0.8rem;
    background: var(--surface-2, #f6f6f6);
    padding: 0.5rem;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    align-items: center;
  }
  .actions input {
    flex: 1;
  }
  .verify {
    font-weight: 600;
  }
  .flag {
    margin-top: 1.25rem;
  }
  .flag form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-width: 32rem;
    padding: 0.5rem 0 0;
  }
  .no-scan form {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
</style>
