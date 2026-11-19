<script lang="ts">
  import Library from '../Library.svelte';
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
</script>

<Library {data} />
