import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ActionConfirmation from './ActionConfirmation.svelte';

const { pushToast } = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock('./toast-store.js', () => ({ getToastStore: () => ({ pushToast }) }));
afterEach(cleanup);

it('announces each submission once, even when successive messages match', async () => {
  const result = { ok: true };
  const message = 'Settings saved.';
  const { rerender } = render(ActionConfirmation, { result, message });
  await rerender({ result, message });
  expect(pushToast).toHaveBeenCalledTimes(1);
  await rerender({ result: { ok: true }, message });
  expect(pushToast).toHaveBeenCalledTimes(2);
  expect(pushToast).toHaveBeenLastCalledWith({ kind: 'success', message });
});
