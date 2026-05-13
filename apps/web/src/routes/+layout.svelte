<script lang="ts">
  import '$lib/styles/tokens.css';
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import VerifyEmailBanner from '$lib/components/auth/VerifyEmailBanner.svelte';
  import ToastHost from '$lib/components/toast/ToastHost.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<!-- T-11.7: renders only when locals.user.emailVerifiedAt is null.
     Sits above AppShell so it spans full width across desktop rail +
     mobile top strip layouts. -->
<VerifyEmailBanner user={data.user} />

<AppShell
  user={data.user}
  currentLanguage={data.currentLanguage}
  availableLanguages={data.availableLanguages}
>
  {@render children()}
</AppShell>

<!-- App-wide toast host. Anything that calls `pushToast()` from
     `$lib/components/toast/toast-store.js` lands here. Rendered
     once at the root so toasts persist across route transitions. -->
<ToastHost />
