<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Group rows by user for the per-member section.
  type Member = {
    userId: string;
    displayName: string | null;
    email: string;
    rows: typeof data.dashboard.rows;
  };
  const members: Member[] = (() => {
    const map = new Map<string, Member>();
    for (const r of data.dashboard.rows) {
      const existing = map.get(r.userId);
      if (existing) {
        existing.rows.push(r);
        continue;
      }
      map.set(r.userId, {
        userId: r.userId,
        displayName: r.displayName,
        email: r.email,
        rows: [r],
      });
    }
    return Array.from(map.values()).sort((a, b) =>
      a.email.localeCompare(b.email),
    );
  })();
</script>

<svelte:head>
  <title>{data.dashboard.group.name} — classroom dashboard</title>
</svelte:head>

<div class="cd">
  <header class="cd-h">
    <h1>{data.dashboard.group.name}</h1>
    {#if data.dashboard.group.description}
      <p class="cd-desc">{data.dashboard.group.description}</p>
    {/if}
    <p class="cd-stats">
      <strong>{data.dashboard.memberCount}</strong> members ·
      <strong>{data.dashboard.sharedTextCount}</strong> shared texts
    </p>
  </header>

  {#each members as m (m.userId)}
    <section class="cd-member">
      <h2>{m.displayName ?? m.email}</h2>
      <p class="cd-email">{m.email}</p>
      <table class="cd-table">
        <thead>
          <tr>
            <th>Text</th>
            <th class="num">Chapter</th>
            <th class="num">% read</th>
            <th class="num">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {#each m.rows as row, i (i)}
            <tr>
              <td><a href={`/reader/${row.textId}`}>{row.textTitle}</a></td>
              <td class="num">{row.lastChapterIdx + 1}</td>
              <td class="num">{Math.round(row.pctRead)}%</td>
              <td class="num cd-when">
                {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {:else}
    <p class="cd-empty">
      No members yet, or no texts shared with the group. Share a text and add
      members to populate the dashboard.
    </p>
  {/each}
</div>

<style>
  .cd {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    color: var(--ink, var(--color-fg));
  }
  .cd-h h1 {
    margin: 0 0 0.2rem;
    font-size: 1.6rem;
    font-family: var(--font-serif, system-ui);
  }
  .cd-desc {
    color: var(--ink-2, var(--color-fg));
    margin: 0 0 0.4rem;
  }
  .cd-stats {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    margin: 0 0 1.5rem;
  }
  .cd-member {
    margin-bottom: 2rem;
  }
  .cd-member h2 {
    font-size: 1rem;
    margin: 0;
    font-family: var(--font-serif, system-ui);
  }
  .cd-email {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
    margin: 0 0 0.5rem;
  }
  .cd-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    overflow: hidden;
  }
  .cd-table th,
  .cd-table td {
    padding: 0.4rem 0.65rem;
    border-bottom: 1px solid var(--rule-2, var(--color-border));
    text-align: left;
  }
  .cd-table th {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 4%, transparent);
    font-weight: 500;
    font-size: 0.78rem;
  }
  .cd-table .num {
    text-align: right;
    font-feature-settings: 'tnum';
    font-family: var(--font-mono-display, var(--font-mono));
  }
  .cd-when {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.78rem;
  }
  .cd-empty {
    padding: 2rem;
    text-align: center;
    color: var(--ink-3, var(--color-fg-muted));
    font-style: italic;
  }
</style>
