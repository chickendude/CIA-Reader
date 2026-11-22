<script lang="ts">
  import { splitMeanings } from '$lib/dictionary/meanings';

  let { text }: { text: string } = $props();
  const meanings = $derived(splitMeanings(text));
</script>

<ol class="definition-meanings" aria-label="Meanings">
  {#each meanings as meaning}
    <li>{meaning}</li>
  {/each}
</ol>

<style>
  .definition-meanings {
    margin: 0;
    padding-inline-start: 1.4em;
    list-style: decimal;
  }
  li + li {
    margin-top: 0.3em;
  }
</style>
