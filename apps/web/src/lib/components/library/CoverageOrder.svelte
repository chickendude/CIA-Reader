<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import SegmentedControl from '$lib/components/input/SegmentedControl.svelte';
  import type { CoverageSort } from '$lib/server/texts/library';

  let { value }: { value: CoverageSort } = $props();
  const options = [
    { value: 'reading', label: 'Reading coverage' },
    { value: 'unique', label: 'Unique words' },
    { value: 'recent', label: 'Newest' },
  ] as const;

  function change(sort: CoverageSort) {
    const url = new URL(page.url);
    url.searchParams.set('sort', sort);
    url.searchParams.delete('offset');
    void goto(url, { keepFocus: true, noScroll: true });
  }
</script>

<div class="order">
  <SegmentedControl label="Sort books by" {options} {value} onChange={change} />
</div>

<style>
  .order { width: fit-content; max-width: 100%; margin-bottom: 1rem; }
</style>
