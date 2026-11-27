<script lang="ts">
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
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
  const joinedFormat = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  });

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

<PageLayout {heading}>
  {@render heading()}
  <nav aria-label="Directory view" class="controls">
    <Button href={href({ view: null, network: null })} aria-current={!filters.grouped ? 'page' : undefined}>Users</Button>
    <Button href={href({ view: 'ips', network: null })} aria-current={filters.grouped ? 'page' : undefined}>Group by IP</Button>
  </nav>
  <form method="get" class="controls">
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
      {#if filters.grouped}
        <select id="order" name="groupOrder" value={filters.groupOrder}>
          <option value="most">Most users</option><option value="fewest">Fewest users</option><option value="recent">Last seen</option>
        </select>
      {:else}
        <select id="order" name="sort" value={filters.sort}>
          <option value="most-ips">Most IP addresses</option><option value="fewest-ips">Fewest IP addresses</option>
          <option value="newest">Newest accounts</option><option value="oldest">Oldest accounts</option>
          <option value="email-asc">Email A to Z</option><option value="email-desc">Email Z to A</option>
          <option value="name">Name A to Z</option><option value="name-desc">Name Z to A</option>
        </select>
      {/if}
    </div>
    <Button type="submit">Apply filters</Button>
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
    {#key page.url.search}
    <form method="post" action={actionUrl('review')} use:enhance onchange={syncSelectPage}>
      {#if data.total}
        <div class="controls select-controls">
          <label><input type="checkbox" name="selectPage" onchange={selectPage} /> Select page</label>
          <Button type="submit">Review deletion</Button>
        </div>
      {/if}
      {#if 'groups' in data && data.groups}
        {#if data.groups.length}
          <div class="entry-table-wrap"><table class="entry-table" aria-label="IP groups in the last 48 hours">
            <thead><tr><th>IP group (48h)</th><th>Users</th><th>Signups</th><th>Last seen</th></tr></thead>
            <tbody>
              {#each data.groups as group (group.network)}
                <tr><td>
                  <input type="checkbox" data-selectable name="network" value={group.network} aria-label={'Select ' + networkLabel(group.network)} />
                  <a href={groupHref(group.network)}>{networkLabel(group.network)}</a>
                </td><td>{group.members}</td><td>{group.signups}</td><td>{joinedFormat.format(group.latest)} UTC</td></tr>
              {/each}
            </tbody>
          </table></div>
        {:else}<p>No IP groups recorded for these filters in the last 48 hours.</p>{/if}
      {:else if 'accounts' in data && data.accounts?.length}
        <div class="entry-table-wrap"><table class="entry-table" aria-label="Users">
          <thead><tr><th>Account</th><th>Activity</th><th>IPs (48h)</th></tr></thead>
          <tbody>
            {#each data.accounts as account (account.id)}
              <tr>
                <td>
                  {#if account.role !== 'admin'}
                    <input type="checkbox" data-selectable name="user" value={account.id} aria-label={'Select ' + account.email} />
                  {/if}
                  <strong>{account.email}</strong>
                  <div>{account.displayName ? `${account.displayName} (${account.role})` : account.role}</div>
                  <div>Joined <time datetime={account.createdAt.toISOString()}>{joinedFormat.format(account.createdAt)} UTC</time></div>
                </td>
                <td>
                  <div>{account.emailVerifiedAt ? 'Email verified' : 'Email unverified'}</div>
                  <div>{account.onboardedAt ? 'Onboarding complete' : 'Onboarding incomplete'}</div>
                  <div>{account.linksCreated} email {account.linksCreated === 1 ? 'link' : 'links'} created</div>
                  <div>{account.textsWithProgress} {account.textsWithProgress === 1 ? 'text' : 'texts'} with reading activity</div>
                </td>
                <td>
                  {#if account.ipCount}
                    <div>{account.ipCount} {account.ipCount === 1 ? 'IP' : 'IPs'}</div>
                    {#each account.networks as network}<div><a href={groupHref(network)}>{networkLabel(network)}</a></div>{/each}
                  {:else}None recorded{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table></div>
      {:else}<p>No users match these filters.</p>{/if}
    </form>
    {/key}
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
  table { table-layout: fixed; line-height: 1.5; }
  td a { color: var(--ink); }
  @media (max-width: 38rem) { .entry-table :is(td, th) { padding: 0.45rem; } }
</style>
