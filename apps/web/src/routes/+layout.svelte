<script lang="ts">
  import '$lib/styles/tokens.css';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<AppShell
  user={data.user}
  currentLanguage={data.currentLanguage}
  availableLanguages={data.availableLanguages}
>
  {@render children()}
</AppShell>
