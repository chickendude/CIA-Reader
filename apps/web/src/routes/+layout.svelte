<script lang="ts">
  import '$lib/styles/tokens.css';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import VerifyEmailBanner from '$lib/components/auth/VerifyEmailBanner.svelte';
  import ToastHost from '$lib/components/toast/ToastHost.svelte';
  import { createToastStore, setToastStore } from '$lib/components/toast/toast-store.js';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
  setToastStore(createToastStore());
</script>

<svelte:head><title>Parhiba</title></svelte:head>

<!-- renders only when locals.user.emailVerifiedAt is null.
     Sits above AppShell so it spans full width across desktop rail +
     mobile top strip layouts. -->
<VerifyEmailBanner user={data.user} />

<AppShell
  user={data.user}
  currentLanguage={data.currentLanguage}
  availableLanguages={data.availableLanguages}
  addableLanguages={data.addableLanguages}
>
  {@render children()}
</AppShell>

<ToastHost />
