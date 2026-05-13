// @vitest-environment jsdom
/**
 * Reproduces the "Regenerating… toast spammed dozens of times" bug
 * reported against /moderation/paradigms/[id].
 *
 * Why this test exists: in Svelte 5, `let foo = $state(null); foo =
 * someObject;` wraps `someObject` in a Proxy — so `someObject === foo`
 * is `false` thereafter. The page's guard
 *     if (!regenResult || regenResult === toastedRegenResult) return;
 * uses reference-equality against a `$state`-typed slot, which fails
 * permanently the moment the slot is assigned. The effect then fires
 * on every reactive tick and pushes a fresh toast each time.
 *
 * The fixture mirrors the page's pattern in two lines so the bug can
 * be exercised in jsdom under a few ms instead of a full Playwright
 * boot. Once the page swaps the `$state` guard for a non-reactive
 * `let`, this test pins it to exactly one toast.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';

import { clearToasts, toasts } from './toast-store.js';
import RegenEffectFixture from './__fixtures__/RegenEffectFixture.svelte';

afterEach(() => {
  cleanup();
  clearToasts();
});

describe('regen-result → toast effect (reproduction)', () => {
  it('pushes exactly one toast for a stable input prop', async () => {
    const input = {
      ok: true as const,
      lemmasProcessed: 1,
      removed: 36,
      inserted: 36,
    };
    render(RegenEffectFixture, { input });
    // Drain the microtask queue so $effect runs to completion +
    // any re-entrant re-runs settle. If the bug is present, the
    // guard fails on the second tick, the assignment re-fires the
    // effect, and the loop pushes a fresh toast on every tick.
    await tick();
    await tick();
    await tick();
    expect(get(toasts)).toHaveLength(1);
  });

  it('pushes a second toast only when the prop reference changes', async () => {
    const inputA = {
      ok: true as const,
      lemmasProcessed: 1,
      removed: 36,
      inserted: 36,
    };
    const inputB = {
      ok: true as const,
      lemmasProcessed: 2,
      removed: 70,
      inserted: 72,
    };
    const { rerender } = render(RegenEffectFixture, { input: inputA });
    await tick();
    expect(get(toasts)).toHaveLength(1);

    // Same content, different reference → should fire again. This
    // matches what SvelteKit's `form` prop does after a fresh
    // action submission: the curator clicks Regenerate again and a
    // new response arrives, even if the numbers happen to match.
    await rerender({ input: { ...inputA } });
    await tick();
    expect(get(toasts)).toHaveLength(2);

    // Different content, different reference → still one new toast.
    await rerender({ input: inputB });
    await tick();
    expect(get(toasts)).toHaveLength(3);
  });

  it('does not push when the prop is null', async () => {
    render(RegenEffectFixture, { input: null });
    await tick();
    await tick();
    expect(get(toasts)).toHaveLength(0);
  });
});
