<script lang="ts">
  import { getToastStore } from './toast-store.js';

  let { result, message }: { result: object; message: string } = $props();
  const { pushToast } = getToastStore();
  let announced: object | undefined;

  $effect(() => {
    // Each submission gets a new result, even when its message is the same.
    if (announced === result) return;
    announced = result;
    pushToast({ kind: 'success', message });
  });
</script>

<noscript><p role="status">{message}</p></noscript>
