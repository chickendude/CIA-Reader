<script lang="ts">
  import HindiWorkshop from '../../../moderation/hindi/workshop/HindiWorkshop.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Hindi book review | Parhiba</title></svelte:head>
<HindiWorkshop {data} reviewOnly />
