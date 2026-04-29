<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { LANGUAGES, SUPPORTED_LANGUAGE_CODES } from '@ciareader/shared-types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function setQuery(params: Record<string, string | null>) {
    const url = new URL(typeof window !== 'undefined' ? window.location.href : 'http://x');
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    void goto(url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''), {
      keepFocus: true,
    });
  }

  let resolutionNote = $state('');
  let acting = $state(false);
  let actionError = $state<string | null>(null);

  async function actionPost(
    path: string,
    body: Record<string, unknown> = {},
  ) {
    if (!data.selected) return;
    acting = true;
    actionError = null;
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        actionError = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
        return;
      }
      resolutionNote = '';
      await invalidateAll();
    } finally {
      acting = false;
    }
  }

  function onAccept() {
    if (!data.selected) return;
    void actionPost(`/api/v1/admin/parse-reports/${data.selected.id}/accept`, {
      resolutionNote: resolutionNote || null,
    });
  }
  function onResolve(status: 'rejected' | 'deferred' | 'duplicate' | 'resolved') {
    if (!data.selected) return;
    if (
      (status === 'rejected' || status === 'duplicate' || status === 'resolved') &&
      !resolutionNote.trim()
    ) {
      actionError = 'Resolution note is required for terminal statuses.';
      return;
    }
    void actionPost(`/api/v1/admin/parse-reports/${data.selected.id}/resolve`, {
      status,
      resolutionNote,
    });
  }
</script>

<svelte:head>
  <title>Parse reports — moderation</title>
</svelte:head>

<div class="mp">
  <header class="mp-h">
    <h1>Parse reports</h1>
    <p class="mp-h-sub">
      User-filed corrections + system-flagged consensus. Accept promotes a fix to
      <code>form_lemma_overrides</code>; reject closes the report.
    </p>
  </header>

  <div class="mp-filters">
    <label>
      <span class="mp-l">Language</span>
      <select
        value={data.filter.language ?? 'any'}
        onchange={(e) =>
          setQuery({ language: (e.target as HTMLSelectElement).value })}
      >
        <option value="any">Any</option>
        {#each SUPPORTED_LANGUAGE_CODES as code}
          {#if data.moderator.role === 'admin' || data.moderator.grantedLanguages.includes(code)}
            <option value={code}>{LANGUAGES[code].displayName}</option>
          {/if}
        {/each}
      </select>
    </label>
    <label>
      <span class="mp-l">Status</span>
      <select
        value={data.filter.status}
        onchange={(e) =>
          setQuery({ status: (e.target as HTMLSelectElement).value })}
      >
        {#each data.statusOptions as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="mp-grid">
    <ul class="mp-list" data-testid="parse-reports-list">
      {#each data.reports as r (r.id)}
        <li>
          <button
            type="button"
            class="mp-item"
            data-active={r.id === data.selected?.id ? '1' : '0'}
            onclick={() => setQuery({ id: r.id })}
          >
            <span class="mp-surface">{r.surfaceNfc}</span>
            <span class="mp-pill">{r.correctionType}</span>
            <span class="mp-pill mp-pill-count">×{r.duplicateCount}</span>
            <span class="mp-meta">
              {r.language} · {r.status}
            </span>
          </button>
        </li>
      {:else}
        <li class="mp-empty">No reports match the filter.</li>
      {/each}
    </ul>

    <section class="mp-detail">
      {#if data.selected}
        <header class="mp-detail-h">
          <h2 class="mp-detail-surface">{data.selected.surfaceNfc}</h2>
          <span class="mp-pill">{data.selected.correctionType}</span>
          <span class="mp-pill">{data.selected.status}</span>
          <span class="mp-pill mp-pill-count">×{data.selected.duplicateCount}</span>
        </header>

        <dl class="mp-meta-list">
          <dt>Language</dt>
          <dd>{data.selected.language}</dd>
          <dt>Context signature</dt>
          <dd><code>{data.selected.contextSignature || '(none)'}</code></dd>
          <dt>Reporter note</dt>
          <dd>{data.selected.note || '(none)'}</dd>
          <dt>Original candidates</dt>
          <dd>
            {#if data.selected.originalCandidates.length === 0}
              <span class="mp-muted">(empty)</span>
            {:else}
              <ul class="mp-cands">
                {#each data.selected.originalCandidates as c, i (i)}
                  <li>
                    <code>{c.lemmaId ?? 'null'}</code>
                    · score {c.score.toFixed(2)}
                  </li>
                {/each}
              </ul>
            {/if}
          </dd>
          <dt>Proposed lemma</dt>
          <dd>
            {#if data.selected.correctedLemmaId}
              <code>{data.selected.correctedLemmaId}</code>
            {:else}
              <span class="mp-muted">(no lemma — mark_*)</span>
            {/if}
          </dd>
        </dl>

        {#if data.selected.status === 'open' || data.selected.status === 'triaged'}
          <div class="mp-actions" data-testid="parse-actions">
            <label class="mp-row">
              <span class="mp-l">Resolution note (required for terminal actions)</span>
              <textarea
                bind:value={resolutionNote}
                rows="2"
                placeholder="Why this decision?"
              ></textarea>
            </label>
            <div class="mp-buttons">
              {#if data.selected.correctedLemmaId}
                <button
                  type="button"
                  class="mp-btn mp-primary"
                  disabled={acting}
                  onclick={onAccept}
                >
                  {acting ? 'Saving…' : 'Accept for everyone'}
                </button>
              {/if}
              <button
                type="button"
                class="mp-btn"
                disabled={acting}
                onclick={() => onResolve('rejected')}
              >
                Reject
              </button>
              <button
                type="button"
                class="mp-btn"
                disabled={acting}
                onclick={() => onResolve('deferred')}
              >
                Defer
              </button>
              <button
                type="button"
                class="mp-btn"
                disabled={acting}
                onclick={() => onResolve('duplicate')}
              >
                Mark duplicate
              </button>
              <button
                type="button"
                class="mp-btn"
                disabled={acting}
                onclick={() => onResolve('resolved')}
              >
                Resolve manually
              </button>
            </div>
            {#if actionError}
              <p class="mp-err" role="alert">{actionError}</p>
            {/if}
          </div>
        {:else}
          <p class="mp-muted">
            Already {data.selected.status}.
            {#if data.selected.resolutionNote}
              — {data.selected.resolutionNote}
            {/if}
          </p>
        {/if}
      {:else}
        <p class="mp-muted mp-empty-detail">
          Select a report on the left to review.
        </p>
      {/if}
    </section>
  </div>
</div>

<style>
  .mp {
    padding: 1.25rem 1.5rem 2rem;
    color: var(--ink, var(--color-fg));
  }
  .mp-h h1 {
    margin: 0 0 0.2rem;
    font-size: 1.4rem;
    font-family: var(--font-serif, system-ui);
  }
  .mp-h-sub {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    margin: 0 0 1rem;
  }
  .mp-filters {
    display: flex;
    gap: 0.85rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .mp-filters label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .mp-l {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  select,
  textarea {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-size: 0.85rem;
  }
  .mp-grid {
    display: grid;
    grid-template-columns: minmax(20rem, 24rem) 1fr;
    gap: 1.25rem;
  }
  @media (max-width: 760px) {
    .mp-grid {
      grid-template-columns: 1fr;
    }
  }
  .mp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-height: 70vh;
    overflow-y: auto;
  }
  .mp-item {
    width: 100%;
    text-align: left;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    padding: 0.55rem 0.65rem;
    cursor: pointer;
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    align-items: center;
    font: inherit;
  }
  .mp-item[data-active='1'] {
    border-color: var(--accent, var(--color-accent));
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 8%, var(--card, var(--color-bg)));
  }
  .mp-surface {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
  }
  .mp-pill {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    border-radius: 999px;
    font-size: 0.62rem;
    padding: 0.18rem 0.45rem;
    color: var(--ink-3, var(--color-fg-muted));
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .mp-pill-count {
    font-feature-settings: 'tnum';
  }
  .mp-meta {
    grid-column: 1 / -1;
    font-size: 0.7rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .mp-empty {
    color: var(--ink-3, var(--color-fg-muted));
    padding: 1rem;
  }
  .mp-detail {
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 10px;
    padding: 1rem 1.1rem;
    background: var(--card, var(--color-bg));
  }
  .mp-detail-h {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--rule, var(--color-border));
    padding-bottom: 0.65rem;
    margin-bottom: 0.85rem;
  }
  .mp-detail-surface {
    font-family: var(--font-serif-dev, var(--font-serif));
    margin: 0;
    font-size: 1.4rem;
  }
  .mp-meta-list {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: 0.45rem 0.85rem;
    margin: 0 0 1rem;
  }
  .mp-meta-list dt {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .mp-meta-list dd {
    margin: 0;
    font-size: 0.9rem;
  }
  .mp-cands {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.78rem;
  }
  .mp-cands li {
    margin: 0.1rem 0;
  }
  .mp-actions {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .mp-row {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .mp-buttons {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .mp-btn {
    background: var(--card-2, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    color: var(--ink, var(--color-fg));
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }
  .mp-primary {
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg));
    border-color: var(--accent, var(--color-accent));
  }
  .mp-err {
    color: var(--err, #b94545);
    font-size: 0.82rem;
    margin: 0;
  }
  .mp-muted {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .mp-empty-detail {
    padding: 1rem;
  }
</style>
