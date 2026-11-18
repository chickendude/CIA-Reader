<script lang="ts">
  import type { ServerToken } from './types.js';
  let {
    token,
    lemmaId,
    label,
    selectedBy,
  }: { token: ServerToken; lemmaId: string; label: string; selectedBy?: 'ai' | 'human' } = $props();
  let saving = $state(false),
    error = $state('');
  async function toggle() {
    if (saving || !token.contextVersion) return;
    const confirmed = [
      ...(token.selectedBy === 'human' && token.lemmaId ? [token.lemmaId] : []),
      ...token.candidates.filter((c) => c.selectedBy === 'human').map((c) => c.lemmaId),
    ];
    const selected = confirmed.length
      ? confirmed.includes(lemmaId)
        ? confirmed.filter((id) => id !== lemmaId)
        : [...confirmed, lemmaId]
      : [lemmaId];
    saving = true;
    error = '';
    try {
      const res = await fetch(`/api/v1/tokens/${token.id}/hindi-context`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectedLemmaIds: selected, expectedVersion: token.contextVersion }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Could not save this selection');
      window.dispatchEvent(new CustomEvent('hindi-context-choice-changed', { detail: data.token }));
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

{#if token.canVerifyContext}
  <button
    type="button"
    aria-pressed={selectedBy === 'human'}
    disabled={saving}
    aria-label={`${selectedBy === 'human' ? 'Clear confirmation of' : 'Confirm'} ${label} for this occurrence`}
    title={selectedBy === 'human'
      ? 'Correct in this context. Click to clear.'
      : 'Mark this entry correct in this context.'}
    onclick={() => void toggle()}
    >{selectedBy === 'ai' ? '✦' : '✓'}
    {saving ? 'Saving…' : selectedBy === 'human' ? 'Confirmed here' : 'Confirm here'}</button
  >
  {#if error}<span role="alert">{error}</span>{/if}
{/if}

<style>
  button {
    font: inherit;
    font-size: 0.75rem;
    white-space: nowrap;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 5px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
  }
  span {
    font-size: 0.8rem;
    color: var(--color-danger, #c33);
  }
</style>
