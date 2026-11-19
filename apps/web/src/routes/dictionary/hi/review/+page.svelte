<script lang="ts">
  import HindiWorkshop from '../../../moderation/hindi/workshop/HindiWorkshop.svelte';
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
</script>

<svelte:head><title>Hindi book review | Parhiba</title></svelte:head>
<HindiWorkshop {data} reviewOnly />
