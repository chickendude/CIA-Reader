<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children, before, class: className, lang, dir }: {
    children: Snippet;
    before?: Snippet;
    class?: string;
    lang?: string;
    dir?: 'ltr' | 'rtl' | 'auto';
  } = $props();
</script>

{@render before?.()}
<h1 {lang} {dir} class={['page-title', className]}>{@render children()}</h1>
