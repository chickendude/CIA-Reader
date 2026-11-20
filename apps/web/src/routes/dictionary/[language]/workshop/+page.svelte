<script lang="ts">
  import Workshop from '$lib/components/dictionary/Workshop.svelte';
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.language.displayName} dictionary workshop | Parhiba</title></svelte:head>
{#key data.language.code}<Workshop {data} />{/key}
