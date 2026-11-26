<script lang="ts">
  import CoverageBar from './CoverageBar.svelte';
  import type { BookWordStats } from '$lib/server/texts/book-stats.js';

  let { stats, signedIn, loginHref, showUniqueCoverage = false }: {
    stats?: BookWordStats | null;
    signedIn: boolean;
    loginHref?: string;
    showUniqueCoverage?: boolean;
  } = $props();
  const number = new Intl.NumberFormat('en');
</script>

<dl class="metrics">
  <div class="coverage">
    <dt>Coverage</dt>
    <dd>
      {#if stats?.learningPct != null}
        <strong>{stats.learningPct}%</strong>
      {:else if !signedIn && loginHref}
        <a href={loginHref}>Sign in</a>
      {:else}
        {signedIn ? 'Unavailable' : 'Sign-in required'}
      {/if}
    </dd>
    {#if stats?.learningPct != null}
      <dd class="scale"><CoverageBar {stats} /></dd>
    {/if}
  </div>
  <div><dt>Word count</dt><dd>{stats ? number.format(stats.words) : 'Unavailable'}</dd></div>
  <div><dt>Unique words</dt><dd>{stats ? number.format(stats.uniqueWords) : 'Unavailable'}
    {#if showUniqueCoverage && stats?.uniquePct != null}<small>{stats.uniquePct}% known</small>{/if}
  </dd></div>
  <div><dt>Unparsed words</dt><dd>{stats ? number.format(stats.unparsedWords) : 'Unavailable'}</dd></div>
</dl>

<style>
  .metrics { display: grid; gap: .4rem; margin: .75rem 0 0; font-size: .85rem; font-variant-numeric: tabular-nums; }
  .metrics > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: .75rem; }
  dt, small { color: var(--ink-3); }
  dd { margin: 0; text-align: end; font-weight: 600; }
  small { display: block; font-weight: 400; font-size: .75rem; }
  .coverage { border-bottom: 1px solid var(--rule); padding-bottom: .55rem; margin-bottom: .15rem; }
  .scale { grid-column: 1 / -1; text-align: start; }
</style>
