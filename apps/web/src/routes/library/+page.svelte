<script lang="ts">
  import Library from './Library.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<Library {data} />
