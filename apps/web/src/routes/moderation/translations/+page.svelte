<!--
  Translation report queue (T-11.1).

  Curators / admins land here to triage reports filed against community
  translations. Each row groups a translation with its open reports and
  exposes Hide / Keep / Dismiss / Promote-reporter actions.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { LANGUAGES, SUPPORTED_LANGUAGE_CODES } from '@ciareader/shared-types';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  function setQuery(params: Record<string, string | null>) {
    const url = new URL(typeof window !== 'undefined' ? window.location.href : 'http://x');
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    void goto(
      url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''),
      { keepFocus: true },
    );
  }

  // Per-row UI state (note text, expanded form). Keyed by translationId
  // (for Hide/Keep) or reportId (for Dismiss). Survives across actions
  // because submissions reload the page data, not this state.
  let openHideFor = $state<string | null>(null);
  let openKeepFor = $state<string | null>(null);
  let openDismissFor = $state<string | null>(null);
  let pendingReason = $state('');
  let pendingNote = $state('');

  function openHide(translationId: string) {
    openHideFor = translationId;
    openKeepFor = null;
    openDismissFor = null;
    pendingReason = '';
  }
  function openKeep(translationId: string) {
    openKeepFor = translationId;
    openHideFor = null;
    openDismissFor = null;
    pendingNote = '';
  }
  function openDismiss(reportId: string) {
    openDismissFor = reportId;
    openHideFor = null;
    openKeepFor = null;
    pendingNote = '';
  }
  function closePopover() {
    openHideFor = null;
    openKeepFor = null;
    openDismissFor = null;
    pendingReason = '';
    pendingNote = '';
  }

  function onActionResult() {
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      if (result.type === 'success') closePopover();
      await update();
    };
  }
</script>

<svelte:head>
  <title>Translation reports — moderation</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="tr">
  <header class="tr-h">
    <h1>Translation reports</h1>
    <p class="tr-h-sub">
      Reader-filed reports against community translations. Hide writes an
      audit row to <code>lemma_edit_history</code>; Keep closes the report
      without touching the translation.
    </p>
    <p class="tr-back"><a href="/moderation/dictionary">← Back to dictionary moderation</a></p>
  </header>

  <div class="tr-filters">
    <label>
      <span class="tr-l">Language</span>
      <select
        value={data.filter.language ?? 'any'}
        onchange={(e) => setQuery({ language: (e.target as HTMLSelectElement).value })}
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
      <span class="tr-l">Status</span>
      <select
        value={data.filter.status}
        onchange={(e) => setQuery({ status: (e.target as HTMLSelectElement).value })}
      >
        {#each data.statusOptions as s}
          <option value={s}>{s.replace('_', ' ')}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if form && 'error' in form && form.error}
    <p class="tr-err" role="alert" data-testid="action-error">{form.error}</p>
  {/if}
  {#if form && 'ok' in form && form.ok && form.action === 'promoteReporter' && form.promoted}
    <p class="tr-ok" role="status">
      Promoted <strong>{form.promoted.email}</strong> to curator. Remember to
      <a href="/moderation/dictionary">grant a language</a>.
    </p>
  {/if}

  {#if data.reports.length === 0}
    <p class="tr-empty" data-testid="reports-empty">
      No reports match the filter.
    </p>
  {:else}
    <ul class="tr-list" data-testid="reports-list">
      {#each data.reports as r (r.report.id)}
        <li class="tr-item" data-testid="report-row" data-report-id={r.report.id}>
          <div class="tr-item-h">
            <span class="tr-pill">{r.lemma.language}</span>
            <span class="tr-headword">{r.lemma.headword}</span>
            <span class="tr-pos">{r.lemma.pos}</span>
            <span class="tr-pill tr-pill-reason">{r.report.reason}</span>
            {#if r.siblingReports > 1}
              <span class="tr-pill tr-pill-count" title="Total reports against this translation">
                {r.siblingReports} reports
              </span>
            {/if}
            <span class="tr-pill tr-pill-status">{r.report.status.replace('_', ' ')}</span>
          </div>

          <blockquote class="tr-body" data-testid="translation-body">
            {r.translation.body}
          </blockquote>

          {#if r.report.note}
            <p class="tr-note">
              <span class="tr-l">Reporter note</span>
              {r.report.note}
            </p>
          {/if}

          <p class="tr-meta">
            Reported by <strong>{r.reporterEmail ?? '[deleted user]'}</strong>
            · {new Date(r.report.createdAt).toLocaleString()}
          </p>

          {#if r.report.status === 'open'}
            <div class="tr-actions" data-testid="report-actions">
              {#if openHideFor === r.translation.id}
                <form
                  method="POST"
                  action="?/hide"
                  use:enhance={onActionResult}
                  class="tr-popover"
                >
                  <input type="hidden" name="translationId" value={r.translation.id} />
                  <label>
                    <span class="tr-l">Reason for hiding (audit trail)</span>
                    <textarea
                      name="reason"
                      bind:value={pendingReason}
                      rows="2"
                      required
                      minlength="3"
                    ></textarea>
                  </label>
                  <div class="tr-popover-foot">
                    <button type="submit" class="tr-btn tr-danger">Confirm hide</button>
                    <button type="button" class="tr-btn tr-ghost" onclick={closePopover}>
                      Cancel
                    </button>
                  </div>
                </form>
              {:else if openKeepFor === r.translation.id}
                <form
                  method="POST"
                  action="?/keep"
                  use:enhance={onActionResult}
                  class="tr-popover"
                >
                  <input type="hidden" name="translationId" value={r.translation.id} />
                  <label>
                    <span class="tr-l">Note (optional)</span>
                    <textarea name="note" bind:value={pendingNote} rows="2"></textarea>
                  </label>
                  <div class="tr-popover-foot">
                    <button type="submit" class="tr-btn">Confirm keep</button>
                    <button type="button" class="tr-btn tr-ghost" onclick={closePopover}>
                      Cancel
                    </button>
                  </div>
                </form>
              {:else if openDismissFor === r.report.id}
                <form
                  method="POST"
                  action="?/dismiss"
                  use:enhance={onActionResult}
                  class="tr-popover"
                >
                  <input type="hidden" name="reportId" value={r.report.id} />
                  <label>
                    <span class="tr-l">Note (optional)</span>
                    <textarea name="note" bind:value={pendingNote} rows="2"></textarea>
                  </label>
                  <div class="tr-popover-foot">
                    <button type="submit" class="tr-btn">Confirm dismiss</button>
                    <button type="button" class="tr-btn tr-ghost" onclick={closePopover}>
                      Cancel
                    </button>
                  </div>
                </form>
              {:else}
                <button
                  type="button"
                  class="tr-btn tr-danger"
                  onclick={() => openHide(r.translation.id)}
                >
                  Hide translation
                </button>
                <button
                  type="button"
                  class="tr-btn"
                  onclick={() => openKeep(r.translation.id)}
                >
                  Keep
                </button>
                <button
                  type="button"
                  class="tr-btn tr-ghost"
                  onclick={() => openDismiss(r.report.id)}
                >
                  Dismiss this report
                </button>
                {#if data.isAdmin && r.report.reporterId}
                  <form
                    method="POST"
                    action="?/promoteReporter"
                    use:enhance={onActionResult}
                    class="tr-promote"
                  >
                    <input type="hidden" name="reporterId" value={r.report.reporterId} />
                    <button type="submit" class="tr-btn tr-promote-btn">
                      Promote reporter to curator
                    </button>
                  </form>
                {/if}
              {/if}
            </div>
          {:else}
            <p class="tr-resolved">
              Resolved as <strong>{r.report.status.replace('_', ' ')}</strong>
              {#if r.report.resolutionNote}— {r.report.resolutionNote}{/if}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .tr {
    padding: 1.25rem 1.5rem 2rem;
    color: var(--ink, var(--color-fg));
    max-width: 64rem;
    margin: 0 auto;
  }
  .tr-h h1 {
    margin: 0 0 0.2rem;
    font-size: 1.4rem;
    font-family: var(--font-serif, system-ui);
  }
  .tr-h-sub {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
  .tr-back {
    margin: 0 0 1rem;
    font-size: 0.8rem;
  }
  .tr-back a {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .tr-filters {
    display: flex;
    gap: 0.85rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .tr-filters label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .tr-l {
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
    font: inherit;
    font-size: 0.85rem;
  }
  .tr-err {
    border: 1px solid #c2410c;
    background: #fef3c7;
    color: #7c2d12;
    padding: 0.6rem 0.85rem;
    border-radius: 8px;
    font-size: 0.85rem;
  }
  .tr-ok {
    border: 1px solid #15803d;
    background: #dcfce7;
    color: #14532d;
    padding: 0.6rem 0.85rem;
    border-radius: 8px;
    font-size: 0.85rem;
  }
  .tr-empty {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.9rem;
    padding: 2rem 0;
    text-align: center;
  }
  .tr-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.85rem;
  }
  .tr-item {
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 10px;
    padding: 0.85rem 1rem;
    background: var(--card, var(--color-bg));
  }
  .tr-item-h {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .tr-pill {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    font-size: 0.66rem;
    border-radius: 999px;
    border: 1px solid var(--rule, var(--color-border));
    color: var(--ink-3, var(--color-fg-muted));
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tr-pill-reason {
    color: #c2410c;
    border-color: #fde68a;
    background: #fff7ed;
  }
  .tr-pill-count {
    color: #b91c1c;
    border-color: #fecaca;
    background: #fef2f2;
  }
  .tr-pill-status {
    color: var(--ink-2, var(--color-fg));
  }
  .tr-headword {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.1rem;
    color: var(--ink, var(--color-fg));
  }
  .tr-pos {
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .tr-body {
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--rule, var(--color-border));
    font-size: 0.95rem;
    color: var(--ink, var(--color-fg));
  }
  .tr-note {
    font-size: 0.85rem;
    color: var(--ink-2, var(--color-fg));
    margin: 0.5rem 0;
  }
  .tr-note .tr-l {
    display: block;
    margin-bottom: 0.15rem;
  }
  .tr-meta {
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 0.5rem 0;
  }
  .tr-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .tr-btn {
    padding: 0.4rem 0.7rem;
    border-radius: 7px;
    border: 1px solid var(--rule, var(--color-border));
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .tr-btn:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 5%, var(--paper, var(--color-bg)));
  }
  .tr-danger {
    color: #b91c1c;
    border-color: #fecaca;
  }
  .tr-ghost {
    background: transparent;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .tr-promote {
    margin: 0;
  }
  .tr-promote-btn {
    color: #1d4ed8;
    border-color: #bfdbfe;
  }
  .tr-popover {
    width: 100%;
    display: grid;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding: 0.75rem;
    border: 1px dashed var(--rule, var(--color-border));
    border-radius: 8px;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 2%, var(--paper, var(--color-bg)));
  }
  .tr-popover label {
    display: grid;
    gap: 0.25rem;
  }
  .tr-popover-foot {
    display: flex;
    gap: 0.5rem;
  }
  .tr-resolved {
    font-size: 0.85rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin-top: 0.5rem;
  }
</style>
