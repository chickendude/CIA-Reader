<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<div class="page">
  <h1>CIA Reader</h1>
  <p class="sub">Comparative Indo-Aryan — a LingQ-style reader for Hindi, Marathi, and Odia.</p>

  <section>
    <h2>Stack status</h2>
    <ul class="status">
      <li>
        Web <span class="ok">up</span>
      </li>
      <li>
        NLP service
        {#if data.nlpStatus === 'ok'}
          <span class="ok">up</span>
        {:else}
          <span class="down">down</span>
        {/if}
      </li>
    </ul>
  </section>

  <section>
    <h2>Supported languages</h2>
    <ul class="langs">
      {#each data.languages as lang}
        <li>
          <span class="native">{lang.nativeName}</span>
          <span class="muted">({lang.displayName} — {lang.script})</span>
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>You</h2>
    {#if data.user}
      <p>
        Signed in as <strong>{data.user.displayName ?? data.user.email}</strong>
        <span class="muted">({data.user.role})</span>
        — <a href="/profile">Profile</a>
      </p>
    {:else}
      <p class="muted">Not signed in. Use <code>/api/v1/auth/register</code> or <code>/api/v1/auth/login</code>.</p>
    {/if}
  </section>

  <section>
    <h2>Smoke test</h2>
    <p>
      <a href="/api/v1/smoke">GET /api/v1/smoke</a> — end-to-end web → NLP round-trip.
    </p>
  </section>
</div>

<style>
  .page {
    max-width: 48rem;
    margin: 0 auto;
    padding: 2rem 1.25rem;
  }
  h1 {
    margin: 0 0 0.25rem;
    font-size: 2rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 1.75rem 0 0.5rem;
    color: var(--color-fg-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sub {
    margin: 0 0 1.5rem;
    color: var(--color-fg-muted);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .status li,
  .langs li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  .ok {
    color: var(--color-success);
    font-weight: 600;
  }
  .down {
    color: var(--color-danger);
    font-weight: 600;
  }
  .muted {
    color: var(--color-fg-muted);
  }
  .native {
    font-size: 1.15rem;
    margin-right: 0.5rem;
  }
  a {
    color: var(--color-accent);
  }
</style>
