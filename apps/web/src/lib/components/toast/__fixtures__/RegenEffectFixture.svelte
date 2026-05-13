<!--
  Test fixture mirroring the regen-result → toast pattern used in
  `/moderation/paradigms/[id]/+page.svelte`. The fixture exists as a
  regression pin: the original bug ("$state-wrapped reference no
  longer === source object") manifested here as Svelte aborting with
  `effect_update_depth_exceeded` after toasts began stacking up.

  The pattern below uses a **plain `let`** for `toastedInput`, NOT a
  `$state` rune. Svelte 5 deeply proxies objects assigned into a
  `$state` slot, so `someObject === toastedInput` is permanently
  false after the assignment, the effect's guard fails, the effect
  re-fires (because `toastedInput` is tracked), and the loop pushes
  a fresh toast every tick.

  If a future refactor "tidies up" by switching this back to $state,
  the test in `regen-effect.test.ts` will fail loudly. Keep it as
  plain `let`.
-->
<script lang="ts">
  import { pushToast } from '../toast-store.js';

  type Input = { ok: true; lemmasProcessed: number; removed: number; inserted: number };
  let { input }: { input: Input | null } = $props();

  let toastedInput: unknown = null;
  $effect(() => {
    if (!input || input === toastedInput) return;
    toastedInput = input;
    pushToast({
      kind: 'success',
      message: `Regenerated ${input.lemmasProcessed} · removed ${input.removed} · inserted ${input.inserted}`,
    });
  });
</script>

<div data-testid="fixture"></div>
