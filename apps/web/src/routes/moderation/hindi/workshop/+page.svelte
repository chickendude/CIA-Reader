<script lang="ts">
  import HindiWorkshop from '$lib/components/dictionary/Workshop.svelte';
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
</script>

<svelte:head><title>Hindi dictionary workshop | Parhiba</title></svelte:head>
<HindiWorkshop {data} />
