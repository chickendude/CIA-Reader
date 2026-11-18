<script lang="ts">
  import PageCloseLink from './PageCloseLink.svelte';

  let { title, href, closeLabel }: { title: string; href: string; closeLabel: string } = $props();
</script>

<header>
  <PageCloseLink {href} label={closeLabel} />
  <h1 class="page-title">{title}</h1>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  header .page-title {
    margin: 0;
  }
</style>
