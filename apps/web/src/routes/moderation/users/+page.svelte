<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
  import { accountColumns, groupColumns, activeDirection } from '$lib/moderation/directory-sort';
  import ReviewDeletion from './ReviewDeletion.svelte';
  import Button from '$lib/components/input/Button.svelte';
  import Pagination from '$lib/components/input/Pagination.svelte';
  import PageLayout from '$lib/components/shell/PageLayout.svelte';
  import SubpageHeading from '$lib/components/shell/SubpageHeading.svelte';
  import ActionConfirmation from '$lib/components/toast/ActionConfirmation.svelte';
  import '$lib/styles/entry-table.css';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const filters = $derived(data.filters);
  const columns = $derived(filters.grouped ? groupColumns : accountColumns);
  const sortKey = $derived(filters.grouped ? 'groupOrder' : 'sort');
  const currentSort = $derived(filters.grouped ? filters.groupOrder.value : filters.sort.value);
  const joinedFormat = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC',
  });

  let clientNow = $state<number | null>(null);
  const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
  onMount(() => {
    clientNow = Date.now();
    const timer = setInterval(() => { clientNow = Date.now(); }, 30_000);
    return () => clearInterval(timer);
  });

  function timeAgo(date: Date, now: number) {
    const seconds = Math.max(0, (now - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return relativeFormat.format(-Math.floor(seconds / 60), 'minute');
    if (seconds < 86400) return relativeFormat.format(-Math.floor(seconds / 3600), 'hour');
    return relativeFormat.format(-Math.floor(seconds / 86400), 'day');
  }

  function href(changes: Record<string, string | null> = {}) {
    const url = new URL(page.url);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('/')) url.searchParams.delete(key);
    }
    url.searchParams.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    return url.pathname + url.search;
  }
  function actionUrl(action: string) {
    const url = new URL(href({ page: String(filters.page) }), page.url);
    return `?/${action}&${url.searchParams}`;
  }
  function selectPage(event: Event) {
    const checkbox = event.currentTarget as HTMLInputElement;
    for (const input of checkbox.form!.querySelectorAll<HTMLInputElement>('[data-selectable]')) {
      input.checked = checkbox.checked;
    }
  }
  function syncSelectPage(event: Event) {
    const box = event.target as HTMLInputElement;
    if (!box.hasAttribute('data-selectable') || !box.form) return;
    const all = box.form.elements.namedItem('selectPage') as HTMLInputElement;
    const selected = box.form.querySelectorAll('[data-selectable]:checked').length;
    all.checked = selected === box.form.querySelectorAll('[data-selectable]').length;
    all.indeterminate = selected > 0 && !all.checked;
  }
  function groupHref(network: string) { return href({ view: null, network, groupOrder: null }); }
  function networkLabel(network: string) { return 'IP group ' + network.slice(0, 12); }
</script>

<svelte:head>
  <title>Users | Moderation | Parhiba</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#snippet heading()}
  <SubpageHeading title="Users" href="/moderation?tab=site" closeLabel="Back to site moderation" />
{/snippet}

{#snippet tableHead()}
  <thead><tr>
    <th scope="col" class="select-column">
      {#key page.url.search}
        <input type="checkbox" name="selectPage" aria-label="Select page" title="Select page" onchange={selectPage} />
      {/key}
    </th>
    {#each columns as column (column.key)}
      {@const active = activeDirection(column, currentSort)}
      {@const next = active === 'ascending' ? 'descending' : active === 'descending' ? 'ascending' : column.first}
      <th scope="col" aria-sort={active}>
        <a href={href({ [sortKey]: column[next][0] })} title={column[next][1]} data-sveltekit-keepfocus data-sveltekit-noscroll>
          {column.label}<span aria-hidden="true">{active === 'ascending' ? ' ↑' : active === 'descending' ? ' ↓' : ''}</span>
        </a>
      </th>
    {/each}
  </tr></thead>
{/snippet}

{#snippet timestamp(date: Date)}
  {@const exact = joinedFormat.format(date)}
  <time datetime={date.toISOString()} title={exact} aria-label={exact}>{timeAgo(date, clientNow ?? data.asOf)}</time>
{/snippet}

{#snippet status(checked: boolean, label: string)}
  <span class="status" role="img" aria-label={label} title={label}>{checked ? '☑' : '☐'}</span>
{/snippet}

<PageLayout {heading}>
  {@render heading()}
  <nav aria-label="Directory view" class="controls">
    <Button href={href({ view: null, network: null })} aria-current={!filters.grouped ? 'page' : undefined}>Users</Button>
    <Button href={href({ view: 'ips', network: null })} aria-current={filters.grouped ? 'page' : undefined}>Group by IP</Button>
  </nav>
  <form method="get" class="controls" onchange={event => event.currentTarget.requestSubmit()} data-sveltekit-keepfocus data-sveltekit-noscroll>
    {#if filters.grouped}<input type="hidden" name="view" value="ips" />{/if}
    {#if filters.network}<input type="hidden" name="network" value={filters.network} />{/if}
    <div class="field">
      <label for="joined">Joined</label>
      <select id="joined" name="joined" value={filters.recent ? '24h' : 'all'}>
        <option value="all">All time</option><option value="24h">Last 24 hours</option>
      </select>
    </div>
    <div class="field">
      <label for="verification">Email status</label>
      <select id="verification" name="verification" value={filters.verification}>
        <option value="all">All emails</option><option value="verified">Verified</option><option value="unverified">Unverified</option>
      </select>
    </div>
    <div class="field">
      <label for="order">Sort by</label>
      <select id="order" name={sortKey} value={currentSort}>
        {#each columns as column (column.key)}
          <optgroup label={column.label}>
            <option value={column.ascending[0]}>{column.ascending[1]}</option>
            <option value={column.descending[0]}>{column.descending[1]}</option>
          </optgroup>
        {/each}
      </select>
    </div>
    <noscript><Button type="submit">Update table</Button></noscript>
  </form>

  {#if form?.preview}
    {#key form.preview}
      <ReviewDeletion accounts={form.preview} action={actionUrl('delete')} cancelHref={href({ page: String(filters.page) })} />
    {/key}
  {:else}
    {#if form?.message}<p role="alert">{form.message}</p>{/if}
    {#if form?.deleted !== undefined}
      <ActionConfirmation result={form} message={`Deleted ${form.deleted} ${form.deleted === 1 ? 'user' : 'users'}.`} />
    {/if}
    {#if filters.network && !filters.grouped}
      <p>{networkLabel(filters.network)} <Button href={href({ network: null })}>Clear IP filter</Button></p>
    {/if}
    <p class="count">{data.total.toLocaleString('en-US')} {filters.grouped ? (data.total === 1 ? 'IP group' : 'IP groups') : (data.total === 1 ? 'user' : 'users')}</p>
    <form method="post" action={actionUrl('review')} use:enhance onchange={syncSelectPage}>
      {#if data.total}
        <div class="controls select-controls">
          <Button type="submit">Review deletion</Button>
        </div>
      {/if}
      {#if 'groups' in data && data.groups}
        {#if data.groups.length}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div class="entry-table-wrap scroll-table" role="region" aria-label="IP group columns" tabindex="0">
            <table class="entry-table" aria-label="IP groups in the last 48 hours">
              {@render tableHead()}
              {#key page.url.search}
                <tbody>
                  {#each data.groups as group (group.network)}
                    <tr>
                      <td><input type="checkbox" data-selectable name="network" value={group.network} aria-label={'Select ' + networkLabel(group.network)} /></td>
                      <td><a href={groupHref(group.network)}>{networkLabel(group.network)}</a></td>
                      <td>{group.members}</td>
                      <td>{group.signups}</td>
                      <td>{@render timestamp(group.latest)}</td>
                    </tr>
                  {/each}
                </tbody>
              {/key}
            </table>
          </div>
        {:else}<p>No IP groups recorded for these filters in the last 48 hours.</p>{/if}
      {:else if 'accounts' in data && data.accounts?.length}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="entry-table-wrap scroll-table" role="region" aria-label="User columns" tabindex="0">
          <table class="entry-table" aria-label="Users">
            {@render tableHead()}
            {#key page.url.search}
              <tbody>
                {#each data.accounts as account (account.id)}
                  <tr>
                    <td>
                      {#if account.role !== 'admin'}
                        <input type="checkbox" data-selectable name="user" value={account.id} aria-label={'Select ' + account.email} />
                      {/if}
                    </td>
                    <td class="identity">{account.email}</td>
                    <td class="identity">{account.displayName ?? ''}</td>
                    <td>{account.role}</td>
                    <td>{@render timestamp(account.createdAt)}</td>
                    <td>{@render status(!!account.emailVerifiedAt, account.emailVerifiedAt ? 'Email verified' : 'Email unverified')}</td>
                    <td>{@render status(!!account.onboardedAt, account.onboardedAt ? 'Onboarding complete' : 'Onboarding incomplete')}</td>
                    <td>{account.linksCreated}</td>
                    <td>{account.textsWithProgress}</td>
                    <td>
                      {#if account.networks.length}
                        <details><summary aria-label={`Show ${account.ipCount} recorded IPs for ${account.email}`}>{account.ipCount}</summary>
                          {#each account.networks as network}<div><a href={groupHref(network)}>{networkLabel(network)}</a></div>{/each}
                        </details>
                      {:else}0{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            {/key}
          </table>
        </div>
      {:else}<p>No users match these filters.</p>{/if}
    </form>
    <Pagination offset={data.offset} limit={data.limit} total={data.total} hrefFor={offset => href({ page: String(Math.floor(offset / data.limit) + 1) })} />
  {/if}
</PageLayout>

<style>
  .controls { display: flex; align-items: end; flex-wrap: wrap; gap: 0.75rem; margin-block: 1rem; }
  nav :global([aria-current]) { background: var(--accent-soft); border-color: var(--accent); }
  .field { display: grid; gap: 0.25rem; font-size: 0.85rem; }
  select { min-height: 2.25rem; padding: 0.35rem; border: 1px solid var(--rule); border-radius: 7px; background: var(--card); color: var(--ink); font: inherit; }
  .count { color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .select-controls { align-items: center; }
  .scroll-table { max-width: 100%; overflow-x: auto; }
  table { line-height: 1.4; font-variant-numeric: tabular-nums; }
  .entry-table :is(th, td) { padding: 0.5rem 0.6rem; vertical-align: middle; }
  .entry-table th { white-space: nowrap; }
  th a { display: block; padding-block: 0.25rem; color: var(--ink-2); text-decoration: none; }
  th[aria-sort] a, th a:hover { color: var(--ink); text-decoration: underline; }
  th a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .select-column { width: 2rem; }
  .identity { min-width: 6rem; max-width: 18rem; }
  time { white-space: nowrap; }
  .status { display: inline-block; font: 1.15rem/1 sans-serif; }
  summary { cursor: pointer; }
  details[open] { min-width: 10rem; }
  td a { color: var(--ink); }
  @media (max-width: 38rem) { .entry-table :is(td, th) { padding: 0.45rem; } }
</style>
