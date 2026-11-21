<script lang="ts">
  import PageCloseLink from './PageCloseLink.svelte';
  import PageTitle from './PageTitle.svelte';

  let { title, href, closeLabel }: { title: string; href: string; closeLabel: string } = $props();
</script>

<div class="subpage-heading">
  <PageTitle>
    {#snippet before()}<PageCloseLink {href} label={closeLabel} />{/snippet}
    {title}
  </PageTitle>
</div>

<style>
  .subpage-heading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .subpage-heading :global(.page-title) {
    margin: 0;
  }
</style>
