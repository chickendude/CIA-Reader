<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import Button from '$lib/components/input/Button.svelte';
  import type { ActionData } from './$types';

  let { accounts, action, cancelHref }: {
    accounts: NonNullable<Extract<ActionData, { preview: unknown }>['preview']>;
    action: string;
    cancelHref: string;
  } = $props();

  let checked = $state<string[]>(untrack(() => accounts.map(account => account.id)));
</script>

<section aria-labelledby="review-heading">
  <h2 id="review-heading">Review deletion</h2>
  <p>Deleting an account permanently removes its private library and reading data.</p>
  <form method="post" {action} use:enhance>
    <ul>
      {#each accounts as account (account.id)}
        <li>
          <label>
            <input type="checkbox" name="user" value={account.id} bind:group={checked} />
            {account.email} ({account.role}, {account.emailVerifiedAt ? 'verified' : 'unverified'})
          </label>
        </li>
      {/each}
    </ul>
    <div class="controls">
      <Button href={cancelHref} data-sveltekit-reload>Cancel</Button>
      <Button type="submit" name="confirm" value="delete" disabled={checked.length === 0}>
        Permanently delete {checked.length} {checked.length === 1 ? 'user' : 'users'}
      </Button>
    </div>
  </form>
</section>

<style>
  ul { max-height: 40vh; overflow: auto; list-style: none; padding: 0; }
  li { padding: 0.3rem; overflow-wrap: anywhere; }
  .controls { display: flex; flex-wrap: wrap; gap: 0.75rem; }
</style>
