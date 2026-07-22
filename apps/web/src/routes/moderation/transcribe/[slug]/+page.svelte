<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Transcribe — {data.citation}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header>
    <nav class="crumbs">
      <a href="/moderation/transcribe">← Workbench</a>
    </nav>
    <h1>{data.citation}</h1>
    <p class="sub">
      {data.progress.verified.toLocaleString()} /
      {data.progress.total.toLocaleString()} verified
      {#if data.progress.flagged > 0}
        · {data.progress.flagged} flagged
      {/if}
    </p>
  </header>

  <section class="calibration">
    <form method="GET">
      <label for="cal-page">Calibration check — view printed page:</label>
      <input
        id="cal-page"
        name="page"
        type="number"
        min="1"
        value={data.calibration?.printedPage ?? ''}
      />
      <button type="submit">View</button>
    </form>
    {#if data.calibration}
      {#if data.calibration.imageUrl}
        <p class="meta">
          Printed page {data.calibration.printedPage} resolves to this
          scan — check the page number printed on the image matches.
        </p>
        <img
          class="cal-img"
          src={data.calibration.imageUrl}
          alt={`Scan for printed page ${data.calibration.printedPage}`}
        />
      {:else}
        <p class="warn">
          No scan page maps to printed page
          {data.calibration.printedPage} — check the ingested volumes
          and their --page-offset / printed range.
        </p>
      {/if}
    {/if}
  </section>

  {#if data.issues.length > 0}
    <section>
      <h2>Open issues</h2>
      <ul class="issues">
        {#each data.issues as issue (issue.id)}
          <li>
            <span class="note">{issue.note}</span>
            {#if issue.lemmaId}
              <a href={`/moderation/transcribe/${data.slug}/${issue.lemmaId}`}>
                entry →
              </a>
            {/if}
            <form method="POST" action="?/resolveIssue" use:enhance>
              <input type="hidden" name="issueId" value={issue.id} />
              <button type="submit">Resolve</button>
            </form>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section>
    <h2>Unverified entries</h2>
    <form method="GET" class="jump">
      <label for="from-page">Jump to printed page:</label>
      <input id="from-page" name="from" type="number" min="1" />
      <button type="submit">Go</button>
    </form>
    {#if data.queue.length === 0}
      <p class="empty">
        Nothing unverified in range — either done, or the importer
        hasn't run yet.
      </p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Headword</th>
            <th>POS</th>
            <th>Page</th>
            <th>Draft gloss</th>
          </tr>
        </thead>
        <tbody>
          {#each data.queue as entry (entry.lemmaId)}
            <tr>
              <td>
                <a href={`/moderation/transcribe/${data.slug}/${entry.lemmaId}`}>
                  {entry.headword}
                </a>
              </td>
              <td>{entry.pos}</td>
              <td>{entry.printedPage ?? '?'}</td>
              <td class="gloss">{entry.glossDefault ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if data.queue.length === 50}
        {@const last = data.queue[data.queue.length - 1]}
        {#if last && last.printedPage !== null}
          <a class="more" href={`?from=${last.printedPage}`}>
            More from page {last.printedPage} →
          </a>
        {/if}
      {/if}
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }
  .crumbs a {
    color: var(--text-secondary, #444);
    text-decoration: none;
  }
  .sub,
  .meta {
    color: var(--text-secondary, #444);
  }
  .warn {
    color: var(--warning-text, #92400e);
  }
  .calibration {
    border: 1px solid var(--border, #ccc);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin: 1rem 0;
  }
  .calibration form,
  .jump {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .calibration input,
  .jump input {
    width: 6rem;
  }
  .cal-img {
    max-width: 100%;
    margin-top: 0.75rem;
    border: 1px solid var(--border, #ccc);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0.75rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border, #ddd);
  }
  .gloss {
    max-width: 28rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary, #444);
  }
  .issues {
    list-style: none;
    padding: 0;
  }
  .issues li {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border, #eee);
  }
  .more {
    display: inline-block;
    margin-top: 0.75rem;
  }
  .empty {
    color: var(--text-secondary, #444);
  }
</style>
