<!--
  Report-translation modal (T-11.1).

  Mounts on top of the reader pop-up's `Sheet` (and any other modal that
  may be open) when the user clicks "Report" on a community translation.
  Submits to `POST /api/v1/translations/:id/report` and reports outcome
  back to the parent via callbacks so the parent can re-render the row
  (e.g. greyed-out + "Reported" badge) without a full popup refetch.

  Anonymous viewers should not reach this component — the parent renders
  a "Sign in to report" link instead.
-->
<script lang="ts">
  import Modal from '../overlay/Modal.svelte';

  type ReportReason = 'spam' | 'incorrect' | 'offensive' | 'duplicate' | 'other';

  type ReportOutcome =
    | { kind: 'reported' }
    | { kind: 'duplicate' }
    | { kind: 'rate_limited'; retryAfterSeconds?: number };

  let {
    open,
    translationId,
    onClose,
    onReported,
  }: {
    open: boolean;
    translationId: string | null;
    onClose: () => void;
    onReported: (outcome: ReportOutcome) => void;
  } = $props();

  const REASONS: { value: ReportReason; label: string }[] = [
    { value: 'spam', label: 'Spam' },
    { value: 'incorrect', label: 'Incorrect translation' },
    { value: 'offensive', label: 'Offensive content' },
    { value: 'duplicate', label: 'Duplicate of an existing translation' },
    { value: 'other', label: 'Other' },
  ];

  let reason = $state<ReportReason>('incorrect');
  let note = $state('');
  let submitting = $state(false);
  let formError = $state<string | null>(null);

  // Reset state whenever the modal opens for a new translation. Without
  // this a stale reason / note would carry between two reports in the
  // same popup session.
  $effect(() => {
    if (open) {
      reason = 'incorrect';
      note = '';
      submitting = false;
      formError = null;
    }
  });

  async function submit() {
    if (!translationId) return;
    if (!reason) {
      formError = 'Please pick a reason.';
      return;
    }
    submitting = true;
    formError = null;
    try {
      const res = await fetch(`/api/v1/translations/${translationId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason,
          note: note.trim() ? note.trim() : null,
        }),
      });
      if (res.status === 201) {
        onReported({ kind: 'reported' });
        onClose();
        return;
      }
      if (res.status === 409) {
        onReported({ kind: 'duplicate' });
        onClose();
        return;
      }
      if (res.status === 429) {
        const errBody = (await res
          .json()
          .catch(() => null)) as { retryAfterSeconds?: number } | null;
        onReported({
          kind: 'rate_limited',
          retryAfterSeconds: errBody?.retryAfterSeconds,
        });
        onClose();
        return;
      }
      const text = await res.text().catch(() => '');
      formError = text || `Could not submit report (HTTP ${res.status})`;
    } catch (e) {
      formError = (e as Error).message ?? 'Network error';
    } finally {
      submitting = false;
    }
  }
</script>

<Modal {open} {onClose} title="Report translation" width={460}>
  <form
    data-testid="report-translation-form"
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <fieldset class="rt-fieldset">
      <legend class="rt-legend">Reason</legend>
      {#each REASONS as r (r.value)}
        <label class="rt-radio">
          <input
            type="radio"
            name="reason"
            value={r.value}
            checked={reason === r.value}
            onchange={() => (reason = r.value)}
            disabled={submitting}
          />
          <span>{r.label}</span>
        </label>
      {/each}
    </fieldset>

    <label class="rt-note">
      <span class="rt-note-l">Note (optional)</span>
      <textarea
        bind:value={note}
        rows="3"
        maxlength="500"
        placeholder="Optional context for the moderators"
        disabled={submitting}
      ></textarea>
    </label>

    {#if formError}
      <p class="rt-err" role="alert" data-testid="report-form-error">{formError}</p>
    {/if}

    <div class="rt-foot">
      <button type="submit" class="rt-btn rt-primary" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit report'}
      </button>
      <button type="button" class="rt-btn" disabled={submitting} onclick={onClose}>
        Cancel
      </button>
    </div>
  </form>
</Modal>

<style>
  .rt-fieldset {
    border: 0;
    padding: 0;
    margin: 0 0 0.85rem;
    display: grid;
    gap: 0.4rem;
  }
  .rt-legend {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
    margin-bottom: 0.25rem;
    padding: 0;
  }
  .rt-radio {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.9rem;
    color: var(--ink, var(--color-fg));
  }
  .rt-note {
    display: grid;
    gap: 0.25rem;
    margin-bottom: 0.85rem;
  }
  .rt-note-l {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  textarea {
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font: inherit;
    font-size: 0.85rem;
    resize: vertical;
  }
  .rt-err {
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
    font-size: 0.85rem;
    margin: 0 0 0.85rem;
  }
  .rt-foot {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .rt-btn {
    padding: 0.45rem 0.85rem;
    border-radius: 7px;
    border: 1px solid var(--rule, var(--color-border));
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .rt-btn:disabled {
    opacity: 0.55;
    cursor: wait;
  }
  .rt-primary {
    color: #b91c1c;
    border-color: #fecaca;
  }
</style>
