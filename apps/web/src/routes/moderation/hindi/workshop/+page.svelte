<script lang="ts">
  import HindiWorkshop from './HindiWorkshop.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Hindi dictionary workshop | Parhiba</title></svelte:head>
<HindiWorkshop {data} />
