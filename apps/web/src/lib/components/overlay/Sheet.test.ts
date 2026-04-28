import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

import Sheet from './Sheet.svelte';
import { __resetScrollLockForTests } from './scroll-lock.js';

beforeEach(() => {
  __resetScrollLockForTests();
  // jsdom doesn't implement scrollTo; the lock-scroll release branch
  // would otherwise pollute stderr.
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  // Tear down the previous test's mount so .sheet-back queries don't
  // pick up a leftover element on the next render.
  cleanup();
  vi.unstubAllGlobals();
  __resetScrollLockForTests();
});

describe('Sheet — dimmed prop (T-5.17)', () => {
  it('paints a dimmed scrim by default', () => {
    const { container } = render(Sheet, { open: true, onClose: () => {} });
    const back = container.querySelector('.sheet-back');
    expect(back).not.toBeNull();
    expect(back!.classList.contains('dimmed')).toBe(true);
  });

  it('omits the .dimmed class when dimmed={false} so the reader text stays readable', () => {
    const { container } = render(Sheet, {
      open: true,
      onClose: () => {},
      dimmed: false,
    });
    const back = container.querySelector('.sheet-back');
    expect(back).not.toBeNull();
    expect(back!.classList.contains('dimmed')).toBe(false);
  });

  it('keeps the backdrop element so click-outside-to-close still works when dimmed=false', async () => {
    let closed = 0;
    const { container } = render(Sheet, {
      open: true,
      dimmed: false,
      onClose: () => {
        closed += 1;
      },
    });
    const back = container.querySelector('.sheet-back') as HTMLElement;
    await fireEvent.click(back);
    expect(closed).toBe(1);
  });
});
