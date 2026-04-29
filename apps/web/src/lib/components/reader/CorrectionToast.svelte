<!--
  Apply-everywhere follow-up toast (T-6.2b).

  Pops up after a correction commits, offering three branches:

    - Apply everywhere (same context): same surface AND same
      worker-chosen primary lemma. The default — least likely to
      over-apply because it inherits the worker's guess at a
      similar grammatical context.
    - Apply everywhere (all contexts): same surface only. The
      sledgehammer.
    - Just this one: dismiss.

  The toast auto-dismisses after 8s. While in flight (an Apply
  click is fetching), the toast doesn't auto-hide; failure
  surfaces inline.
-->
<script lang="ts">
  interface Props {
    open: boolean;
    sourceTokenId: string;
    onDismiss: () => void;
    /** Test seam. */
    fetcher?: typeof fetch;
  }

  let {
    open,
    sourceTokenId,
    onDismiss,
    fetcher = fetch,
  }: Props = $props();

  type Scope = 'same-context' | 'all-contexts';
  let pending = $state<Scope | null>(null);
  let result = $state<{ scope: Scope; applied: number } | null>(null);
  let err = $state<string | null>(null);

  let autoTimer: number | null = null;
  $effect(() => {
    if (!open) return;
    if (pending != null) return; // pause autohide while in flight
    autoTimer = window.setTimeout(() => onDismiss(), 8000);
    return () => {
      if (autoTimer != null) window.clearTimeout(autoTimer);
      autoTimer = null;
    };
  });

  async function apply(scope: Scope) {
    pending = scope;
    err = null;
    try {
      const res = await fetcher(
        '/api/v1/me/token-corrections/apply-everywhere',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sourceTokenId, scope }),
        },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(t || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { applied: number };
      result = { scope, applied: data.applied };
      // Brief delay so the success message reads, then dismiss.
      window.setTimeout(() => onDismiss(), 2200);
    } catch (e) {
      err = e instanceof Error ? e.message : 'Apply failed';
    } finally {
      pending = null;
    }
  }
</script>

{#if open}
  <aside
    class="ct"
    role="status"
    aria-live="polite"
    data-testid="correction-toast"
  >
    {#if result}
      <p class="ct-msg">
        Applied to <strong>{result.applied}</strong>
        {result.applied === 1 ? 'token' : 'tokens'}.
      </p>
    {:else}
      <p class="ct-msg">Correction saved. Apply elsewhere?</p>
      <div class="ct-actions">
        <button
          type="button"
          class="ct-btn ct-primary"
          disabled={pending !== null}
          onclick={() => apply('same-context')}
        >
          {pending === 'same-context' ? 'Applying…' : 'Same context'}
        </button>
        <button
          type="button"
          class="ct-btn"
          disabled={pending !== null}
          onclick={() => apply('all-contexts')}
        >
          {pending === 'all-contexts' ? 'Applying…' : 'All contexts'}
        </button>
        <button
          type="button"
          class="ct-btn ct-ghost"
          disabled={pending !== null}
          onclick={onDismiss}
        >
          Just this one
        </button>
      </div>
      {#if err}
        <p class="ct-err" role="alert">{err}</p>
      {/if}
    {/if}
  </aside>
{/if}

<style>
  .ct {
    position: fixed;
    bottom: 1.25rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    background: var(--ink, #1f1a14);
    color: var(--paper, #fdfaf3);
    border-radius: 12px;
    padding: 0.75rem 1rem;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
    max-width: 32rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    animation: ct-pop-in 200ms ease-out;
  }
  @keyframes ct-pop-in {
    from {
      opacity: 0;
      transform: translate(-50%, 12px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
  .ct-msg {
    margin: 0;
    font-size: 0.85rem;
  }
  .ct-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .ct-btn {
    background: color-mix(in oklch, var(--paper, #fdfaf3) 12%, transparent);
    border: 1px solid color-mix(in oklch, var(--paper, #fdfaf3) 18%, transparent);
    color: var(--paper, #fdfaf3);
    border-radius: 6px;
    padding: 0.35rem 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .ct-btn:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .ct-primary {
    background: var(--accent, var(--color-accent));
    border-color: var(--accent, var(--color-accent));
    color: var(--accent-ink, #1f1a14);
  }
  .ct-ghost {
    background: transparent;
    border-color: transparent;
    text-decoration: underline;
  }
  .ct-err {
    margin: 0;
    color: #ffb5b5;
    font-size: 0.78rem;
  }
</style>
