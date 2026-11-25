<!--
  Verification-status banner.

  Renders at the very top of every page when the signed-in user has
  `email_verified_at IS NULL`. Hidden for verified users and for
  anonymous visitors.

  Only way to dismiss is to verify — intentional friction. Resending
  hits the rate-limited /api/v1/auth/verify-email/resend endpoint.
-->
<script lang="ts">
  import { getToastStore } from '$lib/components/toast/toast-store.js';

  const { pushToast } = getToastStore();

  interface Props {
    user: { emailVerified: boolean } | null;
  }

  let { user }: Props = $props();
  let sending = $state(false);
  let error = $state('');

  async function resend() {
    sending = true;
    error = '';
    try {
      const res = await fetch('/api/v1/auth/verify-email/resend', { method: 'POST' });
      if (res.status === 202) {
        pushToast({ kind: 'success', message: 'Verification email sent. Check your inbox.' });
      } else if (res.status === 204) {
        // Server says we're already verified — reload to refresh the
        // banner-driving page data, banner disappears.
        location.reload();
      } else if (res.status === 429) {
        error = 'Please try again in a minute.';
      } else {
        error = 'Could not resend. Try again later.';
      }
    } catch {
      error = 'Could not resend. Try again later.';
    } finally {
      sending = false;
    }
  }
</script>

{#if user && !user.emailVerified}
  <div class="verify-banner" role="status" aria-live="polite">
    <p class="msg">
      <strong>Verify your email</strong> to publish translations.
      {#if error}
        <span class="status">{error}</span>
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
    color: #991b1b;
  }
  @media (prefers-color-scheme: dark) {
    .status {
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
