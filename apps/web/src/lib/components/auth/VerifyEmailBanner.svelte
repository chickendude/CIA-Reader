<!--
  Verification-status banner (T-11.7).

  Renders at the very top of every page when the signed-in user has
  `email_verified_at IS NULL`. Hidden for verified users and for
  anonymous visitors.

  Only way to dismiss is to verify — intentional friction. Resending
  hits the rate-limited /api/v1/auth/verify-email/resend endpoint.
-->
<script lang="ts">
  interface Props {
    user: { emailVerified: boolean } | null;
  }

  let { user }: Props = $props();
  let sending = $state(false);
  let status = $state<{ kind: 'info' | 'error'; text: string } | null>(null);

  async function resend() {
    sending = true;
    status = null;
    try {
      const res = await fetch('/api/v1/auth/verify-email/resend', { method: 'POST' });
      if (res.status === 202) {
        status = { kind: 'info', text: 'Sent — check your inbox.' };
      } else if (res.status === 204) {
        // Server says we're already verified — reload to refresh the
        // banner-driving page data, banner disappears.
        location.reload();
      } else if (res.status === 429) {
        status = { kind: 'error', text: 'Slow down — try again in a minute.' };
      } else {
        status = { kind: 'error', text: 'Could not resend. Try again later.' };
      }
    } catch {
      status = { kind: 'error', text: 'Could not resend. Try again later.' };
    } finally {
      sending = false;
    }
  }
</script>

{#if user && !user.emailVerified}
  <div class="verify-banner" role="status" aria-live="polite">
    <p class="msg">
      <strong>Verify your email</strong> to publish translations.
      {#if status}
        <span class="status" data-kind={status.kind}>{status.text}</span>
      {/if}
    </p>
    <button class="btn" type="button" onclick={resend} disabled={sending}>
      {sending ? 'Sending…' : 'Resend it'}
    </button>
  </div>
{/if}

<style>
  .verify-banner {
    background: #fef3c7;
    color: #78350f;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.875rem;
    border-bottom: 1px solid #fcd34d;
  }
  @media (prefers-color-scheme: dark) {
    .verify-banner {
      background: #422006;
      color: #fde68a;
      border-bottom-color: #92400e;
    }
  }
  .msg {
    margin: 0;
    flex: 1;
  }
  .status {
    margin-left: 0.5rem;
    opacity: 0.85;
  }
  .status[data-kind='error'] {
    color: #991b1b;
  }
  @media (prefers-color-scheme: dark) {
    .status[data-kind='error'] {
      color: #fca5a5;
    }
  }
  .btn {
    cursor: pointer;
    background: transparent;
    border: 1px solid currentColor;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    color: inherit;
    font: inherit;
  }
  .btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
  }
  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
